/* Dashboard: stats, collection trend, overdue list and recent payments. */
document.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("profileready", loadDashboard, { once: true });
  document.addEventListener("profileready", loadWorkflowDashboard, { once: true });
  const btn = document.getElementById("checkRemindersBtn");
  if (btn) btn.addEventListener("click", () => runRemindersNow(btn));
});

async function runRemindersNow(button) {
  UI.setButtonLoading(button, true);
  try {
    const result = await API.post("/api/workflow/reminders/run");
    UI.toast(
      result.sent
        ? result.sent + " reminder(s) sent."
        : "No reminders were due right now.",
      "success"
    );
    loadWorkflowDashboard();
  } catch (error) {
    UI.toast(error.message, "error");
  } finally {
    UI.setButtonLoading(button, false);
  }
}

async function loadWorkflowDashboard() {
  const statsEl = document.getElementById("workflowStats");
  const upcomingEl = document.getElementById("workflowUpcoming");
  const remindersEl = document.getElementById("workflowReminders");
  const receiptsEl = document.getElementById("workflowReceipts");
  if (!statsEl) return;

  try {
    const data = await API.get("/api/workflow/dashboard");

    statsEl.innerHTML =
      statCard("Today's collections", UI.compactMoney(data.collected_today), "Received today", "&#128176;", "green") +
      statCard("Partial payments", data.partial_count, "Awaiting the remaining balance", "&#8987;", "amber") +
      statCard("Overdue", data.overdue_count, "Total overdue: " + UI.compactMoney(data.overdue_amount), "&#9888;", "red");

    upcomingEl.innerHTML = data.upcoming_due.length
      ? data.upcoming_due
          .map((row) => {
            const tenant = row.tenants ? row.tenants.name : "Leaseholder";
            return (
              '<div class="workflow-list-item"><div><div class="name">' + UI.escapeHtml(tenant) + "</div>" +
              '<div class="meta">' + UI.escapeHtml((row.properties && row.properties.name) || "\u2014") + "</div></div>" +
              '<div class="meta">' + UI.formatDate(row.due_date) + "</div></div>"
            );
          })
          .join("")
      : '<p class="muted">Nothing due in the next 7 days.</p>';

    remindersEl.innerHTML = data.next_reminders.length
      ? data.next_reminders
          .map(
            (r) =>
              '<div class="workflow-list-item"><div class="name">' + UI.escapeHtml(r.tenant) + "</div>" +
              '<div class="meta">' + UI.formatDate(r.due_date) + "</div></div>"
          )
          .join("")
      : '<p class="muted">No reminders scheduled.</p>';

    receiptsEl.innerHTML = data.recent_receipts.length
      ? data.recent_receipts
          .map(
            (r) =>
              '<div class="workflow-list-item"><div class="name">' + UI.escapeHtml(r.receipt_number) + "</div>" +
              '<div class="meta">' + UI.money(r.amount) + " \u00b7 " + UI.escapeHtml(r.payment_mode || "\u2014") + "</div></div>"
          )
          .join("")
      : '<p class="muted">No receipts generated yet.</p>';
  } catch (error) {
    statsEl.innerHTML = "";
    upcomingEl.innerHTML = remindersEl.innerHTML = receiptsEl.innerHTML =
      '<p class="muted">Could not load workflow data.</p>';
  }
}

async function loadDashboard() {
  const statGrid = document.getElementById("statGrid");
  const trendEl = document.getElementById("trendChart");
  const overdueEl = document.getElementById("overdueList");
  const recentEl = document.getElementById("recentPayments");

  try {
    const data = await API.get("/api/dashboard/summary");
    renderStats(statGrid, data.stats);
    renderTrend(trendEl, data.trend);
    renderOverdue(overdueEl, data.overdue);
    renderRecent(recentEl, data.recent_payments);
  } catch (error) {
    UI.toast(error.message, "error");
    const message = '<div class="empty-state"><div class="empty-icon">&#9888;</div>' +
      "<h3>Could not load data</h3><p>" + UI.escapeHtml(error.message) + "</p></div>";
    statGrid.innerHTML = "";
    trendEl.innerHTML = message;
    overdueEl.innerHTML = "";
    recentEl.innerHTML = "";
  }
}

function statCard(label, value, sub, icon, tone) {
  return (
    '<article class="stat-card">' +
      '<div class="stat-top">' +
        '<span class="stat-label">' + UI.escapeHtml(label) + "</span>" +
        '<span class="stat-icon ' + tone + '">' + icon + "</span>" +
      "</div>" +
      '<div class="stat-value">' + value + "</div>" +
      '<div class="stat-sub">' + UI.escapeHtml(sub) + "</div>" +
    "</article>"
  );
}

function renderStats(container, stats) {
  container.innerHTML =
    statCard("Total properties", stats.total_properties, stats.active_tenants + " active leaseholders", "&#9962;", "") +
    statCard("Occupied", stats.occupied_properties, stats.occupancy_rate + "% occupancy rate", "&#128273;", "green") +
    statCard("Vacant", stats.vacant_properties, "Available to rent out", "&#128682;", "cyan") +
    statCard("Monthly rent", UI.compactMoney(stats.monthly_rent), "Expected from occupied units", "&#128181;", "amber") +
    statCard("Pending rent", UI.compactMoney(stats.pending_rent), "Collected this month: " + UI.compactMoney(stats.collected_this_month), "&#9203;", "red");
}

function renderTrend(container, trend) {
  if (!trend || !trend.length) {
    UI.emptyState(container, { icon: "&#128202;", title: "No collection data", message: "Record a rent payment to see the trend." });
    return;
  }
  const max = Math.max.apply(null, trend.map((t) => t.amount).concat([1]));
  container.innerHTML = trend
    .map((point) => {
      const height = Math.max((point.amount / max) * 100, 2);
      return (
        '<div class="chart-col">' +
          '<div class="chart-bar" style="height:' + height + '%"><span>' + UI.compactMoney(point.amount) + "</span></div>" +
          '<span class="chart-label">' + UI.formatMonth(point.month) + "</span>" +
        "</div>"
      );
    })
    .join("");
}

function renderOverdue(container, rows) {
  if (!rows || !rows.length) {
    UI.emptyState(container, { icon: "&#127881;", title: "All rent collected", message: "There is no outstanding rent right now." });
    return;
  }
  container.innerHTML = rows
    .map(
      (row) =>
        '<div class="list-row"><div><strong>' + UI.escapeHtml(row.tenant) + "</strong>" +
        '<span class="cell-sub">' + UI.escapeHtml(row.property || "No property") + " · " + UI.formatMonth(row.period_month) + "</span></div>" +
        '<span class="num" style="color:var(--danger)">' + UI.money(row.outstanding) + "</span></div>"
    )
    .join("");
}

function renderRecent(container, rows) {
  if (!rows || !rows.length) {
    UI.emptyState(container, { icon: "&#128179;", title: "No payments yet", message: "Payments you record will show up here." });
    return;
  }
  container.innerHTML =
    "<table><thead><tr><th>Leaseholder</th><th>Property</th><th>Method</th><th>Date</th>" +
    '<th class="text-right">Amount</th></tr></thead><tbody>' +
    rows
      .map(
        (row) =>
          '<tr><td data-label="Leaseholder">' + '<span class="cell-title">' + UI.escapeHtml(row.tenant) + "</span></td>" +
          '<td data-label="Property">' + UI.escapeHtml(row.property || "—") + "</td>" +
          '<td data-label="Method">' + UI.escapeHtml(row.payment_method || "—") + "</td>" +
          '<td data-label="Date">' + UI.formatDate(row.payment_date) + "</td>" +
          '<td class="text-right num" data-label="Amount">' + UI.money(row.amount_paid) + "</td></tr>"
      )
      .join("") +
    "</tbody></table>";
}
