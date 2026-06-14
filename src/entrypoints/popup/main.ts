import './style.css';

// Phase 0 stub. Phase 1 reads detected streams from storage.session for the active tab and
// renders a one-click "Watch" list (best stream pre-selected, others as failover fallbacks).
// See docs/research/09-ux-permissions.md (§2 detect→watch flow).
const status = document.getElementById('status');
if (status) {
  status.textContent = 'No streams detected on this tab yet.';
}
