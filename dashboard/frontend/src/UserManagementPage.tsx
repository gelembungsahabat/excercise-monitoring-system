import { useState, useEffect, useCallback } from "react";
import { api } from "./api";
import type { User } from "./types";
import { UserPlus, Pencil, Trash2, X, Check, ShieldCheck, User as UserIcon, Users, UserCheck } from "lucide-react";

interface UserFormData {
  username: string;
  password: string;
  email: string;
  role: "admin" | "user";
  is_active: boolean;
}

const EMPTY_FORM: UserFormData = {
  username: "",
  password: "",
  email: "",
  role: "user",
  is_active: true,
};

interface ModalProps {
  title: string;
  onClose: () => void;
  onSubmit: (data: UserFormData) => Promise<void>;
  initial?: Partial<UserFormData>;
  isEdit?: boolean;
}

function UserModal({ title, onClose, onSubmit, initial, isEdit }: ModalProps) {
  const [form, setForm] = useState<UserFormData>({ ...EMPTY_FORM, ...initial });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof UserFormData>(key: K, value: UserFormData[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.username.trim()) return setError("Username is required");
    if (!isEdit && !form.password) return setError("Password is required");
    setLoading(true);
    try {
      await onSubmit(form);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Operation failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2 className="modal__title">{title}</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <form className="modal__body" onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label className="form-label" htmlFor="m-username">Username</label>
            <input
              id="m-username"
              className="form-input"
              type="text"
              value={form.username}
              onChange={(e) => set("username", e.target.value)}
              placeholder="Enter username"
              autoFocus
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="m-password">
              Password {isEdit && <span className="form-label--hint">(leave blank to keep current)</span>}
            </label>
            <input
              id="m-password"
              className="form-input"
              type="password"
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              placeholder={isEdit ? "New password (optional)" : "Enter password"}
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="m-email">Email</label>
            <input
              id="m-email"
              className="form-input"
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="user@example.com"
              disabled={loading}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label" htmlFor="m-role">Role</label>
              <select
                id="m-role"
                className="form-input form-select"
                value={form.role}
                onChange={(e) => set("role", e.target.value as "admin" | "user")}
                disabled={loading}
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Status</label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => set("is_active", e.target.checked)}
                  disabled={loading}
                />
                <span className="toggle__track" />
                <span className="toggle__label">{form.is_active ? "Active" : "Inactive"}</span>
              </label>
            </div>
          </div>

          {error && (
            <div className="form-error">
              <X size={14} />
              {error}
            </div>
          )}

          <div className="modal__footer">
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={loading}>
              {loading ? <span className="btn-spinner" /> : isEdit ? "Save Changes" : "Create User"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface Props {
  currentUserId: string;
}

export function UserManagementPage({ currentUserId }: Props) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listUsers();
      setUsers(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  async function handleCreate(form: UserFormData) {
    const created = await api.createUser({
      username:  form.username.trim(),
      password:  form.password,
      email:     form.email.trim(),
      role:      form.role,
      is_active: form.is_active,
    });
    setUsers((prev) => [...prev, created]);
  }

  async function handleEdit(form: UserFormData) {
    if (!editUser) return;
    const payload: Parameters<typeof api.updateUser>[1] = {
      username:  form.username.trim(),
      email:     form.email.trim(),
      role:      form.role,
      is_active: form.is_active,
    };
    if (form.password) payload.password = form.password;
    const updated = await api.updateUser(editUser.id, payload);
    setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
  }

  async function handleDelete(id: string) {
    setDeleteLoading(true);
    try {
      await api.deleteUser(id);
      setUsers((prev) => prev.filter((u) => u.id !== id));
      setDeleteId(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete user");
    } finally {
      setDeleteLoading(false);
    }
  }

  function fmtDate(iso: string) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric", month: "short", day: "numeric",
    });
  }

  return (
    <main className="content">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">User Management</h1>
          <p className="page-sub">Manage dashboard accounts and permissions</p>
        </div>
        <button className="btn btn--primary" onClick={() => setShowCreate(true)}>
          <UserPlus size={15} />
          Add User
        </button>
      </div>

      {/* Stats row */}
      <div className="metrics-row" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="mcard">
          <div className="mcard__icon mcard__icon--blue"><Users size={18} /></div>
          <div className="mcard__body">
            <div className="mcard__label">Total Users</div>
            <div className="mcard__value">{users.length}</div>
          </div>
        </div>
        <div className="mcard">
          <div className="mcard__icon mcard__icon--green"><UserCheck size={18} /></div>
          <div className="mcard__body">
            <div className="mcard__label">Active</div>
            <div className="mcard__value">{users.filter((u) => u.is_active).length}</div>
          </div>
        </div>
        <div className="mcard">
          <div className="mcard__icon mcard__icon--purple"><ShieldCheck size={18} /></div>
          <div className="mcard__body">
            <div className="mcard__label">Admins</div>
            <div className="mcard__value">{users.filter((u) => u.role === "admin").length}</div>
          </div>
        </div>
      </div>

      {/* Table card */}
      <div className="card">
        <div className="card__head">
          <div className="card__head-left">
            <div className="card__title-icon"><Users size={14} /></div>
            <span className="card__title">All Users</span>
          </div>
          {!loading && !error && users.length > 0 && (
            <span style={{ fontSize: "var(--t-xs)", color: "var(--text-dim)" }}>
              {users.length} account{users.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        {loading ? (
          <div className="loading-state">
            <div className="spinner" />
            <span>Loading users…</span>
          </div>
        ) : error ? (
          <div className="error-state">
            <p>{error}</p>
            <button className="btn btn--ghost" onClick={fetchUsers}>Retry</button>
          </div>
        ) : users.length === 0 ? (
          <div className="empty-state">
            <UserIcon size={40} strokeWidth={1.2} />
            <p>No users found.</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className={u.id === currentUserId ? "table-row--current" : ""}>
                    <td>
                      <div className="user-cell">
                        <div className="user-avatar">
                          {u.username[0].toUpperCase()}
                        </div>
                        <div>
                          <div className="user-cell__name">{u.username}</div>
                          {u.id === currentUserId && (
                            <div className="user-cell__you">You</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="td--sub">{u.email || "—"}</td>
                    <td>
                      <span className={`role-badge role-badge--${u.role}`}>
                        {u.role === "admin" ? <ShieldCheck size={11} /> : <UserIcon size={11} />}
                        {u.role}
                      </span>
                    </td>
                    <td>
                      <span className={`status-badge status-badge--${u.is_active ? "active" : "inactive"}`}>
                        {u.is_active ? <Check size={11} /> : <X size={11} />}
                        {u.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="td--sub">{fmtDate(u.created_at)}</td>
                    <td>
                      <div className="action-btns">
                        <button
                          className="icon-btn icon-btn--edit"
                          title="Edit user"
                          onClick={() => setEditUser(u)}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          className="icon-btn icon-btn--danger"
                          title="Delete user"
                          onClick={() => setDeleteId(u.id)}
                          disabled={u.id === currentUserId}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <UserModal
          title="Add New User"
          onClose={() => setShowCreate(false)}
          onSubmit={handleCreate}
        />
      )}

      {/* Edit modal */}
      {editUser && (
        <UserModal
          title="Edit User"
          isEdit
          onClose={() => setEditUser(null)}
          onSubmit={handleEdit}
          initial={{
            username:  editUser.username,
            email:     editUser.email,
            role:      editUser.role,
            is_active: editUser.is_active,
          }}
        />
      )}

      {/* Delete confirmation */}
      {deleteId && (
        <div className="modal-overlay" onClick={() => setDeleteId(null)}>
          <div className="modal modal--sm" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <h2 className="modal__title">Delete User</h2>
              <button className="modal__close" onClick={() => setDeleteId(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="modal__body">
              <p style={{ color: "var(--text-p)", marginBottom: "var(--s6)" }}>
                Are you sure you want to delete{" "}
                <strong>{users.find((u) => u.id === deleteId)?.username}</strong>?
                This action cannot be undone.
              </p>
              <div className="modal__footer">
                <button className="btn btn--ghost" onClick={() => setDeleteId(null)} disabled={deleteLoading}>
                  Cancel
                </button>
                <button
                  className="btn btn--danger"
                  onClick={() => handleDelete(deleteId)}
                  disabled={deleteLoading}
                >
                  {deleteLoading ? <span className="btn-spinner" /> : "Delete User"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
