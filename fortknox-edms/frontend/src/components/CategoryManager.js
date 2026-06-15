import React, { useState } from 'react';
import { api } from '../auth';
import { useCategories } from '../useCategories';
import { Icon, Button } from './ui';

const ROLES = ['Admin', 'Engineering', 'Legal', 'Management'];

// Admin UI to create/edit/delete categories and their departments.
export default function CategoryManager() {
  const { categories, refresh } = useCategories();
  const [msg, setMsg] = useState('');
  const [adding, setAdding] = useState(false);

  // new-category form
  const [name, setName] = useState('');
  const [roles, setRoles] = useState(['Engineering']);          // view roles
  const [dlRoles, setDlRoles] = useState([]);                   // download roles (subset of view)

  // per-category new-department input
  const [deptInputs, setDeptInputs] = useState({}); // categoryId -> text

  const toggleRole = (r) => setRoles((p) => {
    const next = p.includes(r) ? p.filter((x) => x !== r) : [...p, r];
    // If a role loses view access, it also loses download access.
    setDlRoles((d) => d.filter((x) => next.includes(x)));
    return next;
  });
  const toggleDlRole = (r) => {
    if (!roles.includes(r)) return; // can't download what you can't view
    setDlRoles((p) => (p.includes(r) ? p.filter((x) => x !== r) : [...p, r]));
  };

  const createCategory = async () => {
    if (!name.trim()) return setMsg('Category name is required.');
    if (roles.length === 0) return setMsg('Select at least one view role.');
    try {
      await api.post('/categories', { name: name.trim(), allowedRoles: roles, downloadRoles: dlRoles });
      setName(''); setRoles(['Engineering']); setDlRoles([]); setAdding(false); setMsg('Category created.');
      refresh();
    } catch (e) {
      setMsg(e.response?.data?.error || 'Could not create category.');
    }
  };

  // Update either the view list or the download list for an existing category.
  const updateCategory = async (cat, patch) => {
    try {
      await api.patch(`/categories/${cat._id}`, patch);
      setMsg('Category access updated.');
      refresh();
    } catch (e) {
      setMsg(e.response?.data?.error || 'Could not update category.');
    }
  };

  const deleteCategory = async (cat) => {
    if (!window.confirm(`Delete category "${cat.name}"? This only works if no assets use it.`)) return;
    try {
      await api.delete(`/categories/${cat._id}`);
      setMsg('Category deleted.');
      refresh();
    } catch (e) {
      setMsg(e.response?.data?.error || 'Could not delete category.');
    }
  };

  const addDepartment = async (cat) => {
    const dn = (deptInputs[cat._id] || '').trim();
    if (!dn) return;
    try {
      await api.post('/departments', { name: dn, categoryId: cat._id });
      setDeptInputs((p) => ({ ...p, [cat._id]: '' }));
      refresh();
    } catch (e) {
      setMsg(e.response?.data?.error || 'Could not add department.');
    }
  };

  const deleteDepartment = async (dept) => {
    if (!window.confirm(`Delete department "${dept.name}"?`)) return;
    try {
      await api.delete(`/departments/${dept._id}`);
      refresh();
    } catch (e) {
      setMsg(e.response?.data?.error || 'Could not delete department.');
    }
  };

  // Update a department's own view/download role restrictions.
  const updateDepartment = async (dept, patch) => {
    try {
      await api.patch(`/departments/${dept._id}`, patch);
      refresh();
    } catch (e) {
      setMsg(e.response?.data?.error || 'Could not update department.');
    }
  };

  return (
    <div className="mb-xl">
      <div className="flex justify-between items-center mb-md">
        <h3 className="font-headline-sm text-headline-sm text-primary flex items-center gap-2">
          <Icon name="category" className="text-secondary" /> Categories &amp; Departments
        </h3>
        {!adding && <Button icon="add" onClick={() => setAdding(true)}>New Category</Button>}
      </div>

      {msg && (
        <div className="mb-md px-4 py-2 bg-secondary-container/40 border border-secondary-container rounded font-body-sm text-body-sm flex items-center justify-between">
          <span>{msg}</span>
          <button onClick={() => setMsg('')}><Icon name="close" size={16} /></button>
        </div>
      )}

      {/* New category form */}
      {adding && (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-lg p-lg mb-lg">
          <div className="flex items-center justify-between mb-md">
            <h4 className="font-body-lg font-semibold text-primary">New Category</h4>
            <button onClick={() => setAdding(false)} className="p-1.5 rounded hover:bg-surface-container-high"><Icon name="close" /></button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
            <div>
              <label className="font-label-lg text-label-lg text-on-surface-variant block mb-1">CATEGORY NAME</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Finance"
                className="w-full px-3 py-2 bg-white border border-outline-variant rounded focus:border-primary outline-none font-body-md" />
            </div>
            <div>
              <label className="font-label-lg text-label-lg text-on-surface-variant block mb-1">ROLES THAT CAN VIEW</label>
              <div className="flex flex-wrap gap-2">
                {ROLES.map((r) => (
                  <button key={r} onClick={() => toggleRole(r)}
                    className={`px-3 py-1.5 rounded text-label-lg font-bold border transition-all ${
                      roles.includes(r) ? 'bg-primary text-on-primary border-primary' : 'bg-transparent text-on-surface-variant border-outline-variant hover:border-primary'
                    }`}>
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div className="md:col-span-2">
              <label className="font-label-lg text-label-lg text-on-surface-variant block mb-1">
                ROLES THAT CAN ALSO DOWNLOAD <span className="normal-case font-normal">(must be able to view first)</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {ROLES.map((r) => {
                  const allowed = roles.includes(r);
                  const on = dlRoles.includes(r);
                  return (
                    <button key={r} onClick={() => toggleDlRole(r)} disabled={!allowed}
                      title={allowed ? '' : 'Grant view access first'}
                      className={`px-3 py-1.5 rounded text-label-lg font-bold border transition-all flex items-center gap-1 ${
                        !allowed ? 'opacity-40 cursor-not-allowed border-outline-variant text-on-surface-variant'
                          : on ? 'bg-tertiary text-on-tertiary border-tertiary' : 'bg-transparent text-on-surface-variant border-outline-variant hover:border-tertiary'
                      }`}>
                      {on && <Icon name="download" size={14} />} {r}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="flex justify-end mt-md">
            <Button icon="check" onClick={createCategory}>Create Category</Button>
          </div>
        </div>
      )}

      {/* Category cards */}
      <div className="space-y-md">
        {categories.map((cat) => (
          <div key={cat._id} className="bg-surface-container-lowest border border-outline-variant rounded-lg p-lg">
            <div className="flex items-start justify-between mb-md">
              <div>
                <div className="flex items-center gap-2">
                  <Icon name="folder" className="text-secondary" fill={1} />
                  <span className="font-headline-sm text-headline-sm text-primary">{cat.name}</span>
                </div>
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-widest mr-1 w-16">View:</span>
                  {ROLES.map((r) => {
                    const on = cat.allowedRoles.includes(r);
                    return (
                      <button
                        key={r}
                        onClick={() => {
                          const newView = on ? cat.allowedRoles.filter((x) => x !== r) : [...cat.allowedRoles, r];
                          // Removing view also removes download for that role.
                          const newDl = (cat.downloadRoles || []).filter((x) => newView.includes(x));
                          updateCategory(cat, { allowedRoles: newView, downloadRoles: newDl });
                        }}
                        className={`px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wide border transition-all ${
                          on ? 'bg-secondary-container text-on-secondary-container border-secondary-container' : 'bg-transparent text-on-surface-variant border-outline-variant'
                        }`}
                        title={on ? 'Click to remove view access' : 'Click to grant view access'}
                      >
                        {r}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-widest mr-1 w-16">Download:</span>
                  {ROLES.map((r) => {
                    const canView = cat.allowedRoles.includes(r);
                    const on = (cat.downloadRoles || []).includes(r);
                    return (
                      <button
                        key={r}
                        disabled={!canView}
                        onClick={() => {
                          const dl = cat.downloadRoles || [];
                          const newDl = on ? dl.filter((x) => x !== r) : [...dl, r];
                          updateCategory(cat, { downloadRoles: newDl });
                        }}
                        className={`px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wide border transition-all inline-flex items-center gap-1 ${
                          !canView ? 'opacity-40 cursor-not-allowed border-outline-variant text-on-surface-variant'
                            : on ? 'bg-tertiary text-on-tertiary border-tertiary' : 'bg-transparent text-on-surface-variant border-outline-variant'
                        }`}
                        title={!canView ? 'Grant view access first' : on ? 'Click to revoke download' : 'Click to allow download'}
                      >
                        {on && <Icon name="download" size={11} />}{r}
                      </button>
                    );
                  })}
                </div>
              </div>
              <button onClick={() => deleteCategory(cat)} title="Delete category"
                className="p-2 rounded hover:bg-error-container text-error"><Icon name="delete" size={20} /></button>
            </div>

            {/* Departments with optional per-department permission restrictions */}
            <div className="border-t border-outline-variant pt-md">
              <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-widest">Departments</span>
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-1 mb-2">
                A department with no roles ticked inherits the category&apos;s access. Ticking roles <em>further restricts</em> that department to those roles only.
              </p>
              <div className="space-y-2 mt-2">
                {cat.departments.map((d) => (
                  <div key={d._id} className="bg-surface-container-low rounded p-2">
                    <div className="flex items-center justify-between">
                      <span className="font-body-sm text-body-sm font-semibold text-primary">{d.name}</span>
                      <button onClick={() => deleteDepartment(d)} title="Delete department" className="text-on-surface-variant hover:text-error"><Icon name="close" size={16} /></button>
                    </div>
                    {/* View restriction row (subset of category view roles) */}
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wide w-16">View:</span>
                      {cat.allowedRoles.map((r) => {
                        const on = (d.allowedRoles || []).includes(r);
                        return (
                          <button key={r}
                            onClick={() => {
                              const nextView = on ? d.allowedRoles.filter((x) => x !== r) : [...(d.allowedRoles || []), r];
                              const nextDl = (d.downloadRoles || []).filter((x) => nextView.includes(x));
                              updateDepartment(d, { allowedRoles: nextView, downloadRoles: nextDl });
                            }}
                            className={`px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wide border transition-all ${on ? 'bg-secondary-container text-on-secondary-container border-secondary-container' : 'bg-transparent text-on-surface-variant border-outline-variant'}`}>
                            {r}
                          </button>
                        );
                      })}
                      {(d.allowedRoles || []).length === 0 && <span className="text-[11px] text-on-surface-variant italic">inherits category</span>}
                    </div>
                    {/* Download restriction row (subset of this department's view roles) */}
                    {(d.allowedRoles || []).length > 0 && (
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <span className="font-label-md text-label-md text-on-surface-variant uppercase tracking-wide w-16">Download:</span>
                        {d.allowedRoles.map((r) => {
                          const on = (d.downloadRoles || []).includes(r);
                          return (
                            <button key={r}
                              onClick={() => {
                                const nextDl = on ? d.downloadRoles.filter((x) => x !== r) : [...(d.downloadRoles || []), r];
                                updateDepartment(d, { downloadRoles: nextDl });
                              }}
                              className={`px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wide border inline-flex items-center gap-1 transition-all ${on ? 'bg-tertiary text-on-tertiary border-tertiary' : 'bg-transparent text-on-surface-variant border-outline-variant'}`}>
                              {on && <Icon name="download" size={11} />}{r}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
                {cat.departments.length === 0 && (
                  <span className="font-body-sm text-body-sm text-on-surface-variant italic">No departments yet.</span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-md">
                <input
                  value={deptInputs[cat._id] || ''}
                  onChange={(e) => setDeptInputs((p) => ({ ...p, [cat._id]: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && addDepartment(cat)}
                  placeholder="Add department (e.g. CAD)"
                  className="flex-1 max-w-xs px-3 py-1.5 bg-white border border-outline-variant rounded focus:border-primary outline-none font-body-sm"
                />
                <Button variant="secondary" icon="add" onClick={() => addDepartment(cat)} className="!py-1.5">Add</Button>
              </div>
            </div>
          </div>
        ))}
        {categories.length === 0 && (
          <div className="text-center py-lg text-on-surface-variant font-body-md">No categories yet — create one to start organising assets.</div>
        )}
      </div>
    </div>
  );
}
