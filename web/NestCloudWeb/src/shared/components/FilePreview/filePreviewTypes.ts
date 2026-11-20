export type ViewerType =
  | 'image'
  | 'video'
  | 'audio'
  | 'code'
  | 'office'
  | 'model3d'
  | 'zip'
  | 'fallback';

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'ogg', 'mov', 'mkv', 'avi']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma']);
const CODE_EXTENSIONS = new Set([
  'ts',
  'js',
  'tsx',
  'jsx',
  'py',
  'java',
  'go',
  'rs',
  'c',
  'cpp',
  'h',
  'hpp',
  'sh',
  'bash',
  'sql',
  'yaml',
  'yml',
  'toml',
  'xml',
  'css',
  'scss',
  'less',
  'md',
  'json',
  'html',
  'htm',
  'vue',
  'rb',
  'php',
  'swift',
  'kt',
  'cs',
]);
const OFFICE_EXTENSIONS = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf', 'csv']);
const MODEL3D_EXTENSIONS = new Set(['glb', 'gltf', 'obj', 'stl', 'fbx', 'pmx', 'pmd']);
const ZIP_EXTENSIONS = new Set(['zip']);

export function resolveViewerType(extension: string, mimeType?: string): ViewerType {
  const ext = extension.toLowerCase().replace(/^\./, '');

  if (IMAGE_EXTENSIONS.has(ext) || mimeType?.startsWith('image/')) {
    return 'image';
  }
  if (VIDEO_EXTENSIONS.has(ext) || mimeType?.startsWith('video/')) {
    return 'video';
  }
  if (AUDIO_EXTENSIONS.has(ext) || mimeType?.startsWith('audio/')) {
    return 'audio';
  }
  if (CODE_EXTENSIONS.has(ext) || mimeType?.startsWith('text/')) {
    return 'code';
  }
  if (OFFICE_EXTENSIONS.has(ext) || mimeType === 'application/pdf') {
    return 'office';
  }
  if (MODEL3D_EXTENSIONS.has(ext)) {
    return 'model3d';
  }
  if (ZIP_EXTENSIONS.has(ext)) {
    return 'zip';
  }

  return 'fallback';
}

export function getMonacoLanguage(extension: string): string {
  const ext = extension.toLowerCase().replace(/^\./, '');
  const languageMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    md: 'markdown',
    py: 'python',
    java: 'java',
    go: 'go',
    rs: 'rust',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    sh: 'shell',
    bash: 'shell',
    sql: 'sql',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    xml: 'xml',
    rb: 'ruby',
    php: 'php',
    swift: 'swift',
    kt: 'kotlin',
    cs: 'csharp',
    vue: 'html',
  };

  return languageMap[ext] || 'plaintext';
}
