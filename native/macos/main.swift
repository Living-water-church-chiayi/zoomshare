import AudioToolbox
import Darwin
import Foundation

private func emit(_ value: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(value),
          let data = try? JSONSerialization.data(withJSONObject: value) else { return }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0a]))
}

private func debug(_ message: String) {
    guard ProcessInfo.processInfo.environment["LINGXIU_AUDIO_DEBUG"] == "1" else { return }
    emit(["event": "debug", "message": message])
}

private func number(_ value: Any?, default fallback: Double = 0) -> Double {
    if let number = value as? NSNumber { return number.doubleValue }
    return fallback
}

private func check(_ status: OSStatus, _ operation: String) throws {
    guard status == noErr else {
        throw NSError(
            domain: "com.lingxiu.cover.audio-player",
            code: Int(status),
            userInfo: [NSLocalizedDescriptionKey: "\(operation) failed: \(status)"]
        )
    }
}

private final class CoreAudioOutputPlayer: @unchecked Sendable {
    private let lock = NSRecursiveLock()
    private let channel: String
    private var audioFile: ExtAudioFileRef?
    private var queue: AudioQueueRef?
    private var buffers: [AudioQueueBufferRef] = []
    private var clientFormat = AudioStreamBasicDescription()
    private var bufferByteSize: UInt32 = 0
    private var loop = false
    private var wantsPlayback = false
    private var ended = false
    private var playbackGeneration: UInt64 = 0

    init(channel: String) {
        self.channel = channel
    }

    deinit {
        stop()
    }

    func load(path: String, loop: Bool, volume: Float, position: Double, autoplay: Bool) throws {
        stop()
        var queueToStart: AudioQueueRef?
        lock.lock()
        defer { lock.unlock() }

        playbackGeneration &+= 1
        self.loop = loop
        wantsPlayback = autoplay
        ended = false

        debug("\(channel): open")
        var openedFile: ExtAudioFileRef?
        try check(ExtAudioFileOpenURL(URL(fileURLWithPath: path) as CFURL, &openedFile), "ExtAudioFileOpenURL")
        guard let openedFile else { return }
        audioFile = openedFile

        debug("\(channel): get format")
        var sourceFormat = AudioStreamBasicDescription()
        var sourceFormatSize = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        try check(
            ExtAudioFileGetProperty(
                openedFile,
                kExtAudioFileProperty_FileDataFormat,
                &sourceFormatSize,
                &sourceFormat
            ),
            "ExtAudioFileGetProperty(FileDataFormat)"
        )

        debug("\(channel): set format")
        let sourceChannels = max(1, sourceFormat.mChannelsPerFrame)
        clientFormat = AudioStreamBasicDescription(
            mSampleRate: sourceFormat.mSampleRate > 0 ? sourceFormat.mSampleRate : 44_100,
            mFormatID: kAudioFormatLinearPCM,
            mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked,
            mBytesPerPacket: sourceChannels * UInt32(MemoryLayout<Float32>.size),
            mFramesPerPacket: 1,
            mBytesPerFrame: sourceChannels * UInt32(MemoryLayout<Float32>.size),
            mChannelsPerFrame: sourceChannels,
            mBitsPerChannel: UInt32(MemoryLayout<Float32>.size * 8),
            mReserved: 0
        )

        let clientFormatSize = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        try check(
            ExtAudioFileSetProperty(
                openedFile,
                kExtAudioFileProperty_ClientDataFormat,
                clientFormatSize,
                &clientFormat
            ),
            "ExtAudioFileSetProperty(ClientDataFormat)"
        )

        if position > 0 {
            debug("\(channel): seek initial")
            let targetFrame = Int64(max(0, position) * clientFormat.mSampleRate)
            try check(ExtAudioFileSeek(openedFile, targetFrame), "ExtAudioFileSeek")
        }

        let callback: AudioQueueOutputCallback = { userData, queue, buffer in
            guard let userData else { return }
            let player = Unmanaged<CoreAudioOutputPlayer>.fromOpaque(userData).takeUnretainedValue()
            player.fillAndEnqueue(queue: queue, buffer: buffer)
        }

        debug("\(channel): new queue")
        var newQueue: AudioQueueRef?
        try check(
            AudioQueueNewOutput(
                &clientFormat,
                callback,
                Unmanaged.passUnretained(self).toOpaque(),
                nil,
                nil,
                0,
                &newQueue
            ),
            "AudioQueueNewOutput"
        )
        guard let newQueue else { return }
        queue = newQueue
        setVolumeLocked(volume)

        let framesPerBuffer = UInt32(max(2_048, min(16_384, Int(clientFormat.mSampleRate / 10))))
        bufferByteSize = framesPerBuffer * clientFormat.mBytesPerFrame

        for _ in 0..<3 {
            debug("\(channel): allocate buffer")
            var buffer: AudioQueueBufferRef?
            try check(AudioQueueAllocateBuffer(newQueue, bufferByteSize, &buffer), "AudioQueueAllocateBuffer")
            if let buffer {
                buffers.append(buffer)
                debug("\(channel): fill buffer")
                fillAndEnqueueLocked(queue: newQueue, buffer: buffer)
            }
        }

        if autoplay {
            queueToStart = newQueue
        }

        lock.unlock()
        defer { lock.lock() }
        if let queueToStart {
            debug("\(channel): start")
            try check(AudioQueueStart(queueToStart, nil), "AudioQueueStart")
            debug("\(channel): started")
        }
    }

    func play() throws {
        lock.lock()
        defer { lock.unlock() }
        guard let queue, !ended else { return }
        wantsPlayback = true
        try check(AudioQueueStart(queue, nil), "AudioQueueStart")
    }

    func pause() {
        lock.lock()
        defer { lock.unlock() }
        wantsPlayback = false
        if let queue {
            AudioQueuePause(queue)
        }
    }

    func seek(position: Double) throws {
        lock.lock()
        defer { lock.unlock() }
        guard let audioFile, let queue else { return }
        let wasPlaying = wantsPlayback
        try check(AudioQueuePause(queue), "AudioQueuePause")
        try check(AudioQueueReset(queue), "AudioQueueReset")
        let targetFrame = Int64(max(0, position) * clientFormat.mSampleRate)
        try check(ExtAudioFileSeek(audioFile, targetFrame), "ExtAudioFileSeek")
        ended = false
        for buffer in buffers {
            fillAndEnqueueLocked(queue: queue, buffer: buffer)
        }
        if wasPlaying {
            try check(AudioQueueStart(queue, nil), "AudioQueueStart")
        }
    }

    func setVolume(_ volume: Float) {
        lock.lock()
        defer { lock.unlock() }
        setVolumeLocked(volume)
    }

    func stop() {
        var queueToDispose: AudioQueueRef?
        var audioFileToDispose: ExtAudioFileRef?

        lock.lock()
        playbackGeneration &+= 1
        wantsPlayback = false
        ended = true
        queueToDispose = queue
        queue = nil
        buffers.removeAll()
        audioFileToDispose = audioFile
        audioFile = nil
        lock.unlock()

        if let queueToDispose {
            AudioQueueStop(queueToDispose, true)
            AudioQueueDispose(queueToDispose, true)
        }
        if let audioFileToDispose {
            ExtAudioFileDispose(audioFileToDispose)
        }
    }

    private func setVolumeLocked(_ volume: Float) {
        guard let queue else { return }
        AudioQueueSetParameter(queue, kAudioQueueParam_Volume, max(0, min(1, volume)))
    }

    private func fillAndEnqueue(queue: AudioQueueRef, buffer: AudioQueueBufferRef) {
        lock.lock()
        defer { lock.unlock() }
        fillAndEnqueueLocked(queue: queue, buffer: buffer)
    }

    private func fillAndEnqueueLocked(queue callbackQueue: AudioQueueRef, buffer: AudioQueueBufferRef) {
        guard let audioFile, let queue, queue == callbackQueue, !ended else { return }
        var frames = bufferByteSize / clientFormat.mBytesPerFrame
        var audioBufferList = AudioBufferList(
            mNumberBuffers: 1,
            mBuffers: AudioBuffer(
                mNumberChannels: clientFormat.mChannelsPerFrame,
                mDataByteSize: bufferByteSize,
                mData: buffer.pointee.mAudioData
            )
        )
        let readStatus = ExtAudioFileRead(audioFile, &frames, &audioBufferList)
        guard readStatus == noErr else {
            finishPlayback()
            return
        }

        if frames == 0, loop {
            ExtAudioFileSeek(audioFile, 0)
            frames = bufferByteSize / clientFormat.mBytesPerFrame
            audioBufferList.mBuffers.mDataByteSize = bufferByteSize
            let loopReadStatus = ExtAudioFileRead(audioFile, &frames, &audioBufferList)
            guard loopReadStatus == noErr else {
                finishPlayback()
                return
            }
        }

        if frames > 0 {
            buffer.pointee.mAudioDataByteSize = frames * clientFormat.mBytesPerFrame
            AudioQueueEnqueueBuffer(queue, buffer, 0, nil)
            return
        }

        finishPlayback()
    }

    private func finishPlayback() {
        guard !ended else { return }
        ended = true
        wantsPlayback = false
        let generation = playbackGeneration
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.lock.lock()
            let isCurrent = self.playbackGeneration == generation
            self.lock.unlock()
            guard isCurrent else { return }
            emit(["event": "ended", "channel": self.channel])
            self.stop()
        }
    }
}

private final class PlayerSlot: @unchecked Sendable {
    let channel: String
    private let player: CoreAudioOutputPlayer
    private let queue: DispatchQueue

    init(channel: String) {
        self.channel = channel
        player = CoreAudioOutputPlayer(channel: channel)
        queue = DispatchQueue(label: "com.lingxiu.cover.audio-player.\(channel)")
    }

    func load(path: String, loop: Bool, volume: Float, position: Double, autoplay: Bool) {
        queue.async { [channel, player] in
            do {
                try player.load(path: path, loop: loop, volume: volume, position: position, autoplay: autoplay)
            } catch {
                emit(["event": "error", "channel": channel, "message": error.localizedDescription])
            }
        }
    }

    func play() {
        queue.async { [channel, player] in
            do {
                try player.play()
            } catch {
                emit(["event": "error", "channel": channel, "message": error.localizedDescription])
            }
        }
    }

    func pause() {
        queue.async { [player] in
            player.pause()
        }
    }

    func seek(position: Double) {
        queue.async { [channel, player] in
            do {
                try player.seek(position: position)
            } catch {
                emit(["event": "error", "channel": channel, "message": error.localizedDescription])
            }
        }
    }

    func setVolume(_ volume: Float) {
        queue.async { [player] in
            player.setVolume(volume)
        }
    }

    func stop() {
        queue.sync {
            player.stop()
        }
    }
}

private enum PlayerRegistry {
    static let slots = [
        "music": PlayerSlot(channel: "music"),
        "worship": PlayerSlot(channel: "worship")
    ]
}

private func handle(_ command: [String: Any]) {
    guard let action = command["action"] as? String else { return }
    if action == "shutdown" {
        for slot in PlayerRegistry.slots.values { slot.stop() }
        fflush(stdout)
        exit(0)
    }
    guard let channel = command["channel"] as? String,
          let slot = PlayerRegistry.slots[channel] else { return }

    switch action {
    case "load":
        guard let path = command["path"] as? String else { return }
        slot.load(
            path: path,
            loop: command["loop"] as? Bool ?? false,
            volume: Float(number(command["volume"], default: 1)),
            position: number(command["position"]),
            autoplay: command["autoplay"] as? Bool ?? true
        )
    case "play":
        slot.play()
    case "pause":
        slot.pause()
    case "seek":
        slot.seek(position: number(command["position"]))
    case "volume":
        slot.setVolume(Float(number(command["volume"], default: 1)))
    case "stop":
        slot.stop()
    default:
        break
    }
}

DispatchQueue.global(qos: .userInitiated).async {
    while let line = readLine() {
        guard let data = line.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data),
              let command = object as? [String: Any] else { continue }
        handle(command)
    }
    for slot in PlayerRegistry.slots.values { slot.stop() }
    exit(0)
}

RunLoop.main.run()
