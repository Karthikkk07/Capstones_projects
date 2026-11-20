import { DndContext, type DragEndEvent, PointerSensor, closestCorners, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { type FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { type Board, type Issue, ISSUE_PRIORITIES, ISSUE_TYPES, type IssuePriority, type IssueType } from '../api/types';
import { ErrorBanner, Loading } from '../components/Feedback';
import { useAuth } from '../context/AuthContext';
import { type IssuesByColumn, groupIssuesByColumn, planMove } from '../lib/kanban';
import { errorMessage, useAsync } from '../lib/useAsync';

function Card({ issue, draggable }: { issue: Issue; draggable: boolean }) {
  const drag = useDraggable({ id: issue.id, disabled: !draggable });
  const drop = useDroppable({ id: issue.id });
  const style = drag.transform ? { transform: `translate3d(${drag.transform.x}px, ${drag.transform.y}px, 0)` } : undefined;
  return (
    <div
      ref={(node) => {
        drag.setNodeRef(node);
        drop.setNodeRef(node);
      }}
      style={style}
      className={`kcard${drag.isDragging ? ' dragging' : ''}${drop.isOver && !drag.isDragging ? ' over' : ''}`}
      {...drag.listeners}
      {...drag.attributes}
    >
      <Link to={`/issues/${issue.key}`} className="kcard-title">
        {issue.title}
      </Link>
      <div className="kcard-meta">
        <span className="badge">{issue.key}</span>
        <span className={`badge prio-${issue.priority}`}>{issue.priority}</span>
        <span className="badge">{issue.type}</span>
        {issue.storyPoints !== null && <span className="badge">{issue.storyPoints} pts</span>}
        {issue.assignee && <span className="muted">{issue.assignee.name}</span>}
      </div>
    </div>
  );
}

function Column({ id, name, category, issues, draggable }: { id: string; name: string; category: string; issues: Issue[]; draggable: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section ref={setNodeRef} className={`kcolumn${isOver ? ' over' : ''}`} aria-label={name}>
      <h3>
        {name} <span className="muted">({issues.length})</span>
        <span className={`cat cat-${category}`}>{category.replace('_', ' ')}</span>
      </h3>
      <div className="kcolumn-body">
        {issues.map((i) => (
          <Card key={i.id} issue={i} draggable={draggable} />
        ))}
      </div>
    </section>
  );
}

export function BoardPage() {
  const { projectId = '' } = useParams();
  const { can } = useAuth();
  const canWrite = can('issue:write');
  const { data, error, loading, reload } = useAsync(async () => {
    const [project, boards] = await Promise.all([api.getProject(projectId), api.projectBoards(projectId)]);
    const board: Board | undefined = boards.items[0];
    const issues = board ? (await api.listIssues({ boardId: board.id })).items : [];
    return { project, board, issues };
  }, [projectId]);

  const [groups, setGroups] = useState<IssuesByColumn>({});
  const [moveError, setMoveError] = useState<string | null>(null);
  const [form, setForm] = useState<{ title: string; type: IssueType; priority: IssuePriority }>({ title: '', type: 'TASK', priority: 'MEDIUM' });
  const [formError, setFormError] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    if (data?.board) setGroups(groupIssuesByColumn(data.board.columns, data.issues));
  }, [data]);

  async function onDragEnd(e: DragEndEvent) {
    if (!e.over) return;
    const plan = planMove(groups, String(e.active.id), String(e.over.id));
    if (!plan) return;
    const previous = groups;
    setGroups(plan.next);
    setMoveError(null);
    try {
      await api.moveIssue(plan.issueId, plan.toColumnId, plan.position);
    } catch (err) {
      setGroups(previous);
      setMoveError(errorMessage(err));
    }
  }

  async function createIssue(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    try {
      await api.createIssue({ projectId, boardId: data?.board?.id, ...form });
      setForm({ ...form, title: '' });
      await reload();
    } catch (err) {
      setFormError(errorMessage(err));
    }
  }

  const board = data?.board;
  return (
    <div>
      <Loading loading={loading && !data} error={error}>
        <div className="page-head">
          <h1>
            <span className="badge">{data?.project.key}</span> {data?.project.name}
          </h1>
          <div className="row">
            <Link className="btn" to={`/projects/${projectId}/sprints`}>
              Sprints &amp; backlog
            </Link>
          </div>
        </div>
        {!board ? (
          <p className="muted">This project has no board.</p>
        ) : (
          <>
            {board.transitions.length > 0 && (
              <p className="muted">Workflow rules are enforced: only configured status transitions are allowed.</p>
            )}
            <ErrorBanner message={moveError} onDismiss={() => setMoveError(null)} />
            {canWrite && (
              <form className="row form-inline" onSubmit={createIssue}>
                <input placeholder="New issue title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={200} />
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as IssueType })} aria-label="Type">
                  {ISSUE_TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
                <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as IssuePriority })} aria-label="Priority">
                  {ISSUE_PRIORITIES.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
                <button className="btn btn-primary">Add issue</button>
              </form>
            )}
            <ErrorBanner message={formError} />
            <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={(e) => void onDragEnd(e)}>
              <div className="kboard">
                {board.columns.map((c) => (
                  <Column key={c.id} id={c.id} name={c.name} category={c.category} issues={groups[c.id] ?? []} draggable={canWrite} />
                ))}
              </div>
            </DndContext>
          </>
        )}
      </Loading>
    </div>
  );
}
