(() => {
  const team = document.getElementById('team_select');
  const pitcher = document.getElementById('pitcher_select');
  const hitter = document.getElementById('hitter_select');
  const player = pitcher || hitter;
  if (!team || !player) return;
  const field = pitcher ? 'pitcher' : 'hitter';
  const key = pitcher ? 'gameframe-pitch-people' : 'gameframe-ev-people';
  const exists = (select, value) => value != null && Array.from(select.options).some(option => option.value === String(value) && option.value !== '');
  // Existing explicit choices win. The team's own handler rebuilds valid players.
  if (!team.value && !player.value) {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      if (saved && exists(team, saved.team)) {
        team.value = String(saved.team);
        team.dispatchEvent(new Event('change', {bubbles:true}));
        if (exists(player, saved[field])) player.value = String(saved[field]);
      }
    } catch (_) {}
  }
  function remember() {
    try {
      localStorage.setItem(key, JSON.stringify({team:Number(team.value) || null, [field]:Number(player.value) || null}));
    } catch (_) {}
  }
  team.addEventListener('change', remember);
  player.addEventListener('change', remember);
  player.form?.addEventListener('submit', remember);
})();
