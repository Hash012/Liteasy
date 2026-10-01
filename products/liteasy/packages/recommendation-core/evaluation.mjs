export function ndcg(ids, labels, k = 10) {
  const dcg = (grades) => grades.reduce((sum, grade, rank) => sum + (2 ** grade - 1) / Math.log2(rank + 2), 0);
  const ideal = dcg(Object.values(labels).sort((a,b) => b-a).slice(0,k));
  return ideal ? dcg(ids.slice(0,k).map((id) => labels[id] || 0)) / ideal : 0;
}
export function offTopicRate(ids, labels, k = 10) { const shown = ids.slice(0,k); return shown.length ? shown.filter((id) => labels[id] === 0).length / shown.length : 0; }
