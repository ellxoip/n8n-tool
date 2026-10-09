const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function createJobStore({ directory, execute }) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const jobs = new Map();
  const queue = [];
  let processing = false;
  function save(job) {
    job.updatedAt = new Date().toISOString();
    const file = path.join(directory, `${job.id}.json`);
    fs.writeFileSync(file + '.tmp', JSON.stringify(job), { mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
    return job;
  }
  for (const file of fs.readdirSync(directory).filter(f => /^[a-f0-9-]+\.json$/.test(f))) {
    try {
      const job = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
      if (['running', 'queued'].includes(job.status)) {
        job.status = 'interrupted'; job.error = 'El servicio se reinicio. Revisa el trabajo antes de autorizar otra tarea.';
        save(job);
      }
      jobs.set(job.id, job);
    } catch { /* Ignore corrupt files instead of automatically executing them. */ }
  }
  const fail = message => { throw Object.assign(new Error(message), { status: 409 }); };
  async function drain() {
    if (processing) return;
    processing = true;
    try {
      while (queue.length) {
        const job = jobs.get(queue.shift());
        job.status = 'running'; job.startedAt = new Date().toISOString(); save(job);
        let last = 0;
        try {
          job.result = await execute(job.request, output => {
            job.progress = output.slice(-60000);
            if (Date.now() - last > 1000) { save(job); last = Date.now(); }
          });
          job.status = job.result.ok ? 'awaiting_review' : 'failed';
        } catch (e) { job.status = 'failed'; job.error = e.message; }
        job.finishedAt = new Date().toISOString(); save(job);
      }
    } finally { processing = false; }
  }
  return {
    list: () => [...jobs.values()].sort((a,b) => b.createdAt.localeCompare(a.createdAt)),
    get(id) { const job = jobs.get(id); if (!job) throw Object.assign(new Error('Trabajo no encontrado.'), { status: 404 }); return job; },
    create(body) {
      const task = String(body.task || '').trim();
      const workspace = String(body.workspace || '').trim();
      if (!task || task.length > 12000 || !workspace || path.isAbsolute(workspace) || workspace.split(/[\\/]/).includes('..')) {
        throw Object.assign(new Error('Indica tarea (hasta 12000 caracteres) y proyecto relativo al workspace.'), { status: 400 });
      }
      const job = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), status: 'pending_approval', request: { task, workspace, ...(body.test ? { test: String(body.test) } : {}) } };
      jobs.set(job.id, job); return save(job);
    },
    action(id, action) {
      const job = this.get(id);
      if (action === 'approve') {
        if (job.status !== 'pending_approval') fail('Solo se puede autorizar un trabajo pendiente.');
        job.status = 'queued'; job.approvedAt = new Date().toISOString(); save(job);
        queue.push(id); setImmediate(drain);
      } else if (action === 'reject') {
        if (job.status !== 'pending_approval') fail('Este trabajo ya no esta pendiente.');
        job.status = 'rejected'; save(job);
      } else if (action === 'accept' || action === 'changes') {
        if (job.status !== 'awaiting_review') fail('El trabajo no esta esperando revision.');
        job.status = action === 'accept' ? 'completed' : 'changes_requested'; save(job);
      } else throw Object.assign(new Error('Accion desconocida.'), { status: 400 });
      return job;
    }
  };
}
module.exports = { createJobStore };
