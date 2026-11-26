const toMd = (o, m, r) => `# ${o}\nModel: ${m}\n\n` + r.map((x, i) => `## ${i + 1}. ${x.name}\n\n${x.result}\n`).join('\n');
function download(text, name, type){
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
const cur = () => S.viewing || { objective:S.objective, model:S.model, results:S.results };
$('dlMd').onclick = () => { const c = cur(); download(toMd(c.objective, c.model, c.results), 'taskpilot-results.md', 'text/markdown'); };
$('dlJson').onclick = () => { const c = cur(); download(JSON.stringify({ objective:c.objective, model:c.model, results:c.results }, null, 2), 'taskpilot-results.json', 'application/json'); };
