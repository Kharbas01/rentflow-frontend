/* Workflow notification bell: polling, dropdown rendering, mark as read. */
(function () {
  const POLL_MS = 45000;
  let panelOpen = false;
  let pollTimer = null;

  document.addEventListener("DOMContentLoaded", () => {
    const bell = document.getElementById("notifBell");
    const panel = document.getElementById("notifPanel");
    const markAll = document.getElementById("notifMarkAll");
    if (!bell || !panel) return;

    bell.addEventListener("click", (event) => {
      event.stopPropagation();
      panelOpen ? closePanel() : openPanel();
    });
    document.addEventListener("click", (event) => {
      if (panelOpen && !panel.contains(event.target) && event.target !== bell) closePanel();
    });
    if (markAll) markAll.addEventListener("click", markAllRead);

    refreshBadge();
    pollTimer = setInterval(refreshBadge, POLL_MS);
  });

  function openPanel() {
    panelOpen = true;
    document.getElementById("notifPanel").hidden = false;
    loadList();
  }

  function closePanel() {
    panelOpen = false;
    document.getElementById("notifPanel").hidden = true;
  }

  async function refreshBadge() {
    try {
      const result = await API.get("/api/workflow/notifications", { unread_only: true, limit: 1 });
      const badge = document.getElementById("notifBadge");
      if (!badge) return;
      if (!result.available || !result.unread_count) {
        badge.hidden = true;
      } else {
        badge.hidden = false;
        badge.textContent = result.unread_count > 9 ? "9+" : String(result.unread_count);
      }
    } catch (error) {
      // Silent: notifications are a nice-to-have, never interrupt the app.
    }
  }

  async function loadList() {
    const list = document.getElementById("notifList");
    list.innerHTML = '<div class="notif-empty">Loading…</div>';
    try {
      const result = await API.get("/api/workflow/notifications", { limit: 20 });
      if (!result.available) {
        list.innerHTML = '<div class="notif-empty">Notifications aren\u2019t set up yet. Run database/migrations_v5.sql in Supabase.</div>';
        return;
      }
      const items = result.items || [];
      if (!items.length) {
        list.innerHTML = '<div class="notif-empty">You\u2019re all caught up.</div>';
        return;
      }
      list.innerHTML = items
        .map(
          (n) =>
            '<div class="notif-item ' + (n.is_read ? "" : "unread") + '" data-id="' + n.id + '">' +
              '<div class="notif-item-body">' +
                '<div class="notif-item-title">' + UI.escapeHtml(n.title) + "</div>" +
                '<div class="notif-item-message">' + UI.escapeHtml(n.message) + "</div>" +
                '<div class="notif-item-time">' + UI.formatDate(String(n.created_at || "").slice(0, 10)) + "</div>" +
              "</div>" +
            "</div>"
        )
        .join("");
      list.querySelectorAll(".notif-item.unread").forEach((el) =>
        el.addEventListener("click", () => markRead(el.dataset.id, el))
      );
    } catch (error) {
      list.innerHTML = '<div class="notif-empty">Could not load notifications.</div>';
    }
  }

  async function markRead(id, el) {
    try {
      await API.post("/api/workflow/notifications/" + id + "/read");
      if (el) el.classList.remove("unread");
      refreshBadge();
    } catch (error) {
      // ignore
    }
  }

  async function markAllRead() {
    try {
      await API.post("/api/workflow/notifications/read-all");
      loadList();
      refreshBadge();
    } catch (error) {
      UI.toast(error.message, "error");
    }
  }
})();
