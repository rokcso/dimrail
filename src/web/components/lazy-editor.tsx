import { lazy, Suspense } from 'react';
import type { YamlEditorProps } from './yaml-editor';

// CodeMirror 单独成块：口令页与骨架不必等它下载
const YamlEditor = lazy(() => import('./yaml-editor').then((mod) => ({ default: mod.YamlEditor })));

export function LazyYamlEditor(props: YamlEditorProps) {
  return (
    <Suspense fallback={null}>
      <YamlEditor {...props} />
    </Suspense>
  );
}
