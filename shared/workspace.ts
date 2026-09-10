export const MAX_FILE_SIZE = 512_000;
export const MAX_FOLDER_SIZE = 8_000_000;
export const MAX_FILES = 100;
export const SUPPORTED_EXTENSIONS = /\.(md|txt|csv|tsv|json|html|css|js|ts|tsx|jsx|yaml|yml|rst)$/i;
export function allowedPath(path: string) {
  const pieces = path.replaceAll('\\', '/').split('/');
  return (
    pieces.every(
      (p) =>
        p &&
        p !== '..' &&
        !p.startsWith('.') &&
        !/^(node_modules|dist|build|vendor|coverage|private|credentials?|secrets?|id_rsa|id_ed25519)$/i.test(
          p,
        ),
    ) &&
    !/(^|[\/_.-])(secret|credential|password|token|private[-_]?key|api[-_]?key)s?([\/_.-]|$)/i.test(path) &&
    SUPPORTED_EXTENSIONS.test(path)
  );
}
export function containsSecret(text: string) {
  return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9]{30,})\b|(?:api[_-]?key|access[_-]?token|password|client[_-]?secret)\s*[=:]\s*["']?[^\s"']{8,}/i.test(
    text,
  );
}
