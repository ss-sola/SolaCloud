-- =============================================================================
-- 变更脚本：rag_knowledge_document 表新增 processed_chunks 列
-- 变更日期：2026-07-11
-- 变更说明：支持向量化处理进度追踪
-- =============================================================================

-- 新增 processed_chunks 列
alter table rag_knowledge_document
    add column if not exists processed_chunks integer default 0;

-- 为历史已完成的文档补充 processed_chunks 值（等于 chunk_count）
update rag_knowledge_document
set processed_chunks = chunk_count
where processing_status = 'completed'
  and processed_chunks = 0
  and chunk_count > 0;

-- 字段注释
comment on column rag_knowledge_document.processed_chunks is '已完成分片数';

-- 更新 chunk_count 注释
comment on column rag_knowledge_document.chunk_count is '分片总数';
