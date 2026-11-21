/**
 * 本地 Monaco Editor 封装。
 * 通过 @monaco-editor/react 的 loader API 将 Monaco 路径指向本地安装的
 * monaco-editor 包（ESM 入口），绕过默认的 CDN 加载行为。
 */
import { Editor, loader } from '@monaco-editor/react';
import type { EditorProps } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import tsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker';

// 注册本地 Web Worker，覆盖 Monaco 默认的 CDN worker 加载逻辑
self.MonacoEnvironment = {
  getWorker(_: unknown, label: string) {
    if (label === 'typescript' || label === 'javascript') {
      return new tsWorker();
    }
    return new editorWorker();
  },
};

// 告知 @monaco-editor/react 直接使用已导入的 monaco 实例，不再走网络请求
loader.config({ monaco });

export default function MonacoEditorLocal(props: EditorProps) {
  return <Editor {...props} />;
}
