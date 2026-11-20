import { useCallback, useEffect, useState } from 'react';
import { RagApi } from '../api/ragApi';
import type { KnowledgeBase } from '../types/rag.types';

export function RagKnowledgePage() {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');

  useEffect(() => {
    void loadKnowledgeBases();
  }, []);

  const loadKnowledgeBases = useCallback(async () => {
    const list = await RagApi.listKnowledgeBases();
    setKnowledgeBases(list);
  }, []);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    await RagApi.createKnowledgeBase({
      name: newName,
      description: newDescription || undefined,
    });
    setShowCreateModal(false);
    setNewName('');
    setNewDescription('');
    void loadKnowledgeBases();
  }, [newName, newDescription, loadKnowledgeBases]);

  return (
    <div className="container-fluid p-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h3>知识库管理</h3>
        <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
          创建知识库
        </button>
      </div>

      <div className="row">
        {knowledgeBases.map((kb) => (
          <div key={kb.id} className="col-md-4 mb-3">
            <div className="card">
              <div className="card-body">
                <h5 className="card-title">{kb.name}</h5>
                <p className="card-text text-muted">{kb.description || '暂无描述'}</p>
                <div className="d-flex justify-content-between align-items-center">
                  <small className="text-muted">
                    {kb.embeddingModel} ({kb.embeddingDimension}维)
                  </small>
                  <span className={`badge bg-${kb.status === 'active' ? 'success' : 'secondary'}`}>
                    {kb.status}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 创建知识库模态框 */}
      {showCreateModal && (
        <div
          className="modal show d-block"
          tabIndex={-1}
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
        >
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">创建知识库</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setShowCreateModal(false)}
                />
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <label className="form-label">知识库名称</label>
                  <input
                    type="text"
                    className="form-control"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="输入知识库名称"
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label">描述（可选）</label>
                  <textarea
                    className="form-control"
                    rows={3}
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    placeholder="输入描述信息"
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowCreateModal(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleCreate}
                  disabled={!newName.trim()}
                >
                  创建
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
