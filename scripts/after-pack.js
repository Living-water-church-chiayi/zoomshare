'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const UNUSED_MEDIA_USAGE_KEYS = Object.freeze([
  'NSMicrophoneUsageDescription',
  'NSCameraUsageDescription',
  'NSAudioCaptureUsageDescription'
]);

function collectAppInfoPlists(rootAppPath) {
  const infoPlists = [];
  const pending = [rootAppPath];

  while (pending.length > 0) {
    const appPath = pending.pop();
    const infoPlist = path.join(appPath, 'Contents', 'Info.plist');
    if (fs.existsSync(infoPlist)) infoPlists.push(infoPlist);

    const frameworksPath = path.join(appPath, 'Contents', 'Frameworks');
    if (!fs.existsSync(frameworksPath)) continue;
    for (const entry of fs.readdirSync(frameworksPath, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.endsWith('.app')) {
        pending.push(path.join(frameworksPath, entry.name));
      }
    }
  }

  return infoPlists;
}

function readPlist(infoPlist) {
  const json = execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', infoPlist], {
    encoding: 'utf8'
  });
  return JSON.parse(json);
}

function stripUnusedMediaUsageDescriptions(infoPlist) {
  const before = readPlist(infoPlist);
  for (const key of UNUSED_MEDIA_USAGE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(before, key)) {
      execFileSync('/usr/bin/plutil', ['-remove', key, infoPlist]);
    }
  }

  const after = readPlist(infoPlist);
  const remaining = UNUSED_MEDIA_USAGE_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(after, key));
  if (remaining.length > 0) {
    throw new Error(`Unused macOS media permissions remain in ${infoPlist}: ${remaining.join(', ')}`);
  }
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const rootAppPath = path.join(context.appOutDir, `${appName}.app`);
  const infoPlists = collectAppInfoPlists(rootAppPath);
  if (infoPlists.length === 0) {
    throw new Error(`Cannot find a macOS Info.plist under ${rootAppPath}`);
  }

  for (const infoPlist of infoPlists) stripUnusedMediaUsageDescriptions(infoPlist);
  console.log(`Removed unused macOS media permission declarations from ${infoPlists.length} app bundle(s).`);
};

module.exports.UNUSED_MEDIA_USAGE_KEYS = UNUSED_MEDIA_USAGE_KEYS;
module.exports.collectAppInfoPlists = collectAppInfoPlists;
