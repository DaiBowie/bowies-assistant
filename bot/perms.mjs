// Discord permission names, in bit order (bit 0 first). Used to read and write permissions in plain words.
export const PERMS = [
  'Create invite', 'Kick', 'Ban', 'Administrator', 'Manage channels', 'Manage server', 'Add reactions', 'View audit log',
  'Priority speaker', 'Stream', 'View channel', 'Send messages', 'Send TTS', 'Manage messages', 'Embed links', 'Attach files',
  'Read history', 'Mention everyone', 'External emojis', 'Server insights', 'Connect', 'Speak', 'Mute members', 'Deafen members',
  'Move members', 'Voice activity', 'Change nickname', 'Manage nicknames', 'Manage roles', 'Manage webhooks', 'Manage expressions',
  'Use app commands', 'Request to speak', 'Manage events', 'Manage threads', 'Public threads', 'Private threads', 'External stickers',
  'Send in threads', 'Activities', 'Timeout members', 'Monetisation analytics', 'Soundboard', 'Create expressions', 'Create events',
  'External sounds', 'Voice messages', '47', '48', 'Polls', 'External apps', 'Pin messages', 'Bypass slowmode',
];

/** @param {string[]} list */
export function bits(list = []) {
  let b = 0n;
  for (const name of list) {
    const i = PERMS.indexOf(name);
    if (i < 0) throw new Error(`Unknown permission "${name}"`);
    b |= 1n << BigInt(i);
  }
  return b.toString();
}
