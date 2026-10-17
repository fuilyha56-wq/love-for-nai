type TreeNode = { at: number; id: string; priority: number; size: number; left?: TreeNode; right?: TreeNode };
const size = (node?: TreeNode) => node?.size || 0;
function update(node: TreeNode) { node.size = 1 + size(node.left) + size(node.right); return node; }
function compare(at: number, id: string, node: TreeNode) { return at - node.at || (id < node.id ? -1 : id > node.id ? 1 : 0); }
function merge(left?: TreeNode, right?: TreeNode): TreeNode | undefined {
  if (!left) return right; if (!right) return left;
  if (left.priority < right.priority) { left.right = merge(left.right, right); return update(left); }
  right.left = merge(left, right.left); return update(right);
}
function insert(root: TreeNode | undefined, node: TreeNode): TreeNode {
  if (!root) return node;
  if (compare(node.at, node.id, root) < 0) {
    root.left = insert(root.left, node);
    if (root.left.priority < root.priority) { const next = root.left; root.left = next.right; next.right = update(root); return update(next); }
  } else {
    root.right = insert(root.right, node);
    if (root.right.priority < root.priority) { const next = root.right; root.right = next.left; next.left = update(root); return update(next); }
  }
  return update(root);
}
function remove(root: TreeNode | undefined, at: number, id: string): TreeNode | undefined {
  if (!root) return;
  const order = compare(at, id, root);
  if (order === 0) return merge(root.left, root.right);
  if (order < 0) root.left = remove(root.left, at, id); else root.right = remove(root.right, at, id);
  return update(root);
}
function rank(root: TreeNode | undefined, at: number, inclusive: boolean): number {
  if (!root) return 0;
  if (root.at < at || inclusive && root.at === at) return size(root.left) + 1 + rank(root.right, at, inclusive);
  return rank(root.left, at, inclusive);
}
/** Bounded treap: insertion, eviction and exact window counts are expected O(log n). */
export class RequestUsageIndex {
  private users = new Map<number, TreeNode>();
  private seen = new Map<string, { userId: number; at: number }>();
  private sequence = 0;
  constructor(private readonly capacity = 100000) {}
  add(userId: number, at: number, requestId?: string): void {
    if (!Number.isInteger(userId) || userId <= 0 || !Number.isFinite(at)) return;
    const id = `${userId}:${requestId || at}`;
    if (this.seen.has(id)) return;
    this.seen.set(id, { userId, at });
    // Mix an internal sequence so caller-controlled IDs cannot skew the tree.
    let priority = ++this.sequence;
    priority = Math.imul(priority ^ priority >>> 16, 0x45d9f3b);
    priority = Math.imul(priority ^ priority >>> 16, 0x45d9f3b);
    priority = (priority ^ priority >>> 16) >>> 0;
    this.users.set(userId, insert(this.users.get(userId), { at, id, priority, size: 1 }));
    if (this.seen.size > this.capacity) {
      const oldest = this.seen.keys().next().value!, event = this.seen.get(oldest)!;
      this.seen.delete(oldest);
      const root = remove(this.users.get(event.userId), event.at, oldest);
      if (root) this.users.set(event.userId, root); else this.users.delete(event.userId);
    }
  }
  count(userId: number, windowMs: number, now: number): number {
    const root = this.users.get(userId);
    return rank(root, now, true) - rank(root, now - windowMs, false);
  }
  summary(userId: number, now: number) {
    return { userId, requests5h: this.count(userId, 5 * 3600000, now), requests7d: this.count(userId, 7 * 86400000, now), requests30d: this.count(userId, 30 * 86400000, now), retainedRecords: this.count(userId, Infinity, now) };
  }
}
