const params = new URLSearchParams(location.search);
const target = params.get('target') || '';
const label = document.querySelector('#targetLabel');
label.textContent = target ? `Cible : ${target}` : 'Ajoutez ?target=r/nom ou ?target=u/nom à l’URL.';
const form = document.querySelector('#form'),
    status = document.querySelector('#status'),
    button = document.querySelector('#go');
let started = false;

function opts() {
    return {
        target,
        sort: document.querySelector('#sort').value,
        time: document.querySelector('#time').value,
        limit: Number(document.querySelector('#limit').value),
        images: document.querySelector('#images').checked,
        videos: document.querySelector('#videos').checked,
        mergeAudio: document.querySelector('#mergeAudio').checked,
        format: document.querySelector('#format').value
    };
}
async function start() {
    if (started) return;
    started = true;
    button.disabled = true;
    status.textContent = 'Création de la tâche…';
    try {
        const r = await fetch('/api/jobs', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(opts())
        });
        const data = await r.json();
        if (!r.ok) throw Error(data.error || 'Erreur de création.');
        poll(data.id);
    } catch (e) {
        status.textContent = e.message;
        started = false;
        button.disabled = false;
    }
}
async function poll(id) {
    try {
        const r = await fetch(`/api/jobs/${encodeURIComponent(id)}`),
            j = await r.json();
        if (!r.ok) throw Error(j.error);
        status.textContent = `${j.status==='complete'?'Terminé':j.status==='error'?'Erreur':'Traitement'} — ${j.progress||0}%` + (j.error ? `\n${j.error}` : '') + (j.warnings?.length ? `\nAvertissements : ${j.warnings.join(' ; ')}` : '');
        if (j.status === 'complete') {
            if (j.download) {
                const a = document.createElement('a');
                a.href = j.download;
                a.textContent = 'Télécharger l’archive';
                a.style = 'display:block;color:#fb923c;margin-top:12px';
                status.append(document.createElement('br'), a);
            }
            for (const f of j.files || []) {
                const a = document.createElement('a');
                a.href = f.url;
                a.textContent = f.name;
                a.style = 'display:block;color:#fb923c';
                status.append(document.createElement('br'), a);
            }
            button.disabled = false;
			started = false;
            return;
        }
        if (j.status === 'error') {
            button.disabled = false;
            started = false;
            return;
        }
        setTimeout(() => poll(id), 1200);
    } catch (e) {
        status.textContent = e.message;
        button.disabled = false;
        started = false;
    }
}
form.addEventListener('submit', e => {
    e.preventDefault();
    start();
});
if (params.get('auto') === '1' && target) start();