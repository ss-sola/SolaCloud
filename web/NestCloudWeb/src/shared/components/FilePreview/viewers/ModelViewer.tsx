import { Canvas } from '@react-three/fiber';
import { Center, Environment, OrbitControls, useGLTF } from '@react-three/drei';
import { useLoader } from '@react-three/fiber';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { MMDLoader } from 'three-stdlib';
import * as THREE from 'three';
import { Component, useEffect, useState, type ReactNode } from 'react';

interface ModelViewerProps {
  url: string;
  fileName: string;
  extension: string;
}

function GltfModel({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  return <primitive object={scene} />;
}

function ObjModel({ url }: { url: string }) {
  const obj = useLoader(OBJLoader, url);
  return <primitive object={obj} />;
}

function StlModel({ url }: { url: string }) {
  const geometry = useLoader(STLLoader, url);
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color="#8899aa" />
    </mesh>
  );
}

function PmxModel({ url }: { url: string }) {
  const [mesh, setMesh] = useState<THREE.SkinnedMesh | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loader = new MMDLoader();

    loader.load(
      url,
      (loadedMesh) => {
        if (cancelled) return;

        // 修复 morphTargets 兼容性警告：新版 three.js 不再需要 material.morphTargets
        if (Array.isArray(loadedMesh.material)) {
          loadedMesh.material.forEach((mat) => {
            delete (mat as unknown as Record<string, unknown>).morphTargets;
            delete (mat as unknown as Record<string, unknown>).morphNormals;
          });
        } else if (loadedMesh.material) {
          delete (loadedMesh.material as unknown as Record<string, unknown>).morphTargets;
          delete (loadedMesh.material as unknown as Record<string, unknown>).morphNormals;
        }

        setMesh(loadedMesh);
      },
      undefined,
      (err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : '加载 PMX 模型失败');
      },
    );

    return () => {
      cancelled = true;
    };
  }, [url]);

  if (error) {
    return (
      <mesh>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color="red" wireframe />
      </mesh>
    );
  }
  if (!mesh) {
    return null;
  }

  return <primitive object={mesh} />;
}

function ModelContent({ url, extension }: { url: string; extension: string }) {
  const ext = extension.toLowerCase();

  if (ext === 'glb' || ext === 'gltf') {
    return <GltfModel url={url} />;
  }
  if (ext === 'obj') {
    return <ObjModel url={url} />;
  }
  if (ext === 'stl') {
    return <StlModel url={url} />;
  }
  if (ext === 'pmx' || ext === 'pmd') {
    return <PmxModel url={url} />;
  }

  return null;
}

/** 错误边界：防止模型加载失败导致整个页面崩溃 */
class ModelErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; errorMessage: string }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorMessage: error.message || '模型加载失败' };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="d-flex flex-column justify-content-center align-items-center p-5 text-center"
          style={{ minHeight: '400px' }}
        >
          <div className="text-danger mb-3" style={{ fontSize: '3rem' }}>
            &#x26A0;
          </div>
          <h5>模型加载失败</h5>
          <p className="text-muted small">{this.state.errorMessage}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

export function ModelViewer({ url, extension }: ModelViewerProps) {
  return (
    <ModelErrorBoundary>
      <div style={{ height: '70vh', minHeight: '400px', backgroundColor: '#000000' }}>
        <Canvas
          camera={{ position: [0, 15, 30], fov: 45 }}
          gl={{ outputColorSpace: THREE.SRGBColorSpace }}
        >
          {/* PMX/MMD 模型使用 ToonMaterial，需要柔和均匀的光照还原贴图色彩 */}
          <color attach="background" args={['#000000']} />
          <ambientLight intensity={2.0} />
          <directionalLight position={[0, 10, 10]} intensity={0.3} />
          <OrbitControls target={[0, 10, 0]} />
          <gridHelper args={[20, 20, '#333333', '#1a1a1a']} />
          <Center disableY>
            <ModelContent url={url} extension={extension} />
          </Center>
        </Canvas>
      </div>
    </ModelErrorBoundary>
  );
}
