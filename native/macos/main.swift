import AVFoundation
import Darwin
import Foundation

private func emit(_ value: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(value),
          let data = try? JSONSerialization.data(withJSONObject: value) else { return }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0a]))
}

private final class PlayerSlot {
    let channel: String
    var player: AVPlayer?
    var endObserver: NSObjectProtocol?
    var shouldLoop = false

    init(channel: String) {
        self.channel = channel
    }

    deinit {
        removeObserver()
    }

    private func removeObserver() {
        if let endObserver {
            NotificationCenter.default.removeObserver(endObserver)
            self.endObserver = nil
        }
    }

    func load(path: String, loop: Bool, volume: Float, position: Double, autoplay: Bool) {
        stop()
        shouldLoop = loop
        let item = AVPlayerItem(url: URL(fileURLWithPath: path))
        let nextPlayer = AVPlayer(playerItem: item)
        nextPlayer.volume = volume
        player = nextPlayer
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self] _ in
            guard let self, let player = self.player else { return }
            if self.shouldLoop {
                player.seek(to: .zero, toleranceBefore: .zero, toleranceAfter: .zero) { finished in
                    if finished { player.play() }
                }
            } else {
                emit(["event": "ended", "channel": self.channel])
            }
        }

        let start = CMTime(seconds: max(0, position), preferredTimescale: 600)
        if position > 0 {
            nextPlayer.seek(to: start, toleranceBefore: .zero, toleranceAfter: .zero) { finished in
                if autoplay && finished { nextPlayer.play() }
            }
        } else if autoplay {
            nextPlayer.play()
        }
    }

    func play() {
        player?.play()
    }

    func pause() {
        player?.pause()
    }

    func seek(position: Double) {
        let target = CMTime(seconds: max(0, position), preferredTimescale: 600)
        player?.seek(to: target, toleranceBefore: .zero, toleranceAfter: .zero)
    }

    func setVolume(_ volume: Float) {
        player?.volume = volume
    }

    func stop() {
        player?.pause()
        player?.replaceCurrentItem(with: nil)
        player = nil
        shouldLoop = false
        removeObserver()
    }
}

private let slots = [
    "music": PlayerSlot(channel: "music"),
    "worship": PlayerSlot(channel: "worship")
]

private func number(_ value: Any?, default fallback: Double = 0) -> Double {
    if let number = value as? NSNumber { return number.doubleValue }
    return fallback
}

private func handle(_ command: [String: Any]) {
    guard let action = command["action"] as? String else { return }
    if action == "shutdown" {
        for slot in slots.values { slot.stop() }
        fflush(stdout)
        exit(0)
    }
    guard let channel = command["channel"] as? String,
          let slot = slots[channel] else { return }

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
        DispatchQueue.main.async { handle(command) }
    }
    DispatchQueue.main.async {
        for slot in slots.values { slot.stop() }
        exit(0)
    }
}

RunLoop.main.run()
