// tsx uses os.userInfo() to name its temp directory when geteuid is unavailable.
// Windows Node can fail that lookup in restricted environments; a stable fallback
// is sufficient because tsx only uses this value as a temp-directory suffix.
if (typeof process.geteuid !== 'function') {
  process.geteuid = () => 0;
  require('node:os').userInfo = () => ({ username: 'sim' });
  if (!process.env.NODE_OPTIONS?.includes(__filename)) {
    process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --require=${__filename}`.trim();
  }
}
