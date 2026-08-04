/* Rent & payments: history, filters, mark paid, generate monthly records, PDF report. */
(function () {
  const state = { items: [], tenants: [], search: "", status: "all", month: "" };

  document.addEventListener("DOMContentLoaded", () => {
    ["paymentModal", "payModal", "generateModal", "reportModal", "historyModal"].forEach(UI.bindModalClose);

    document.getElementById("addPaymentBtn").addEventListener("click", () => openForm());
    document.getElementById("generateBtn").addEventListener("click", openGenerate);
    document.getElementById("reportBtn").addEventListener("click", () => UI.openModal("reportModal"));
    document.getElementById("paymentForm").addEventListener("submit", save);
    document.getElementById("payForm").addEventListener("submit", confirmPayment);
    document.getElementById("generateForm").addEventListener("submit", generate);
    document.getElementById("reportForm").addEventListener("submit", downloadReport);

    bindTypeTabs("paymentTypeTabs", "paymentType", "paymentTypeNoteField");
    bindTypeTabs("payTypeTabs", "payType", "payTypeNoteField");

    document.getElementById("paymentSearch").addEventListener(
      "input",
      UI.debounce((e) => { state.search = e.target.value.trim(); load(); }, 320)
    );
    document.getElementById("paymentStatusFilter").addEventListener("change", (e) => {
      state.status = e.target.value; load();
    });
    document.getElementById("paymentMonthFilter").addEventListener("change", (e) => {
      state.month = e.target.value; load();
    });
    document.getElementById("clearFilters").addEventListener("click", () => {
      state.search = ""; state.status = "all"; state.month = "";
      document.getElementById("paymentSearch").value = "";
      document.getElementById("paymentStatusFilter").value = "all";
      document.getElementById("paymentMonthFilter").value = "";
      load();
    });

    document.getElementById("payMethod").addEventListener("change", toggleWorkflowFields);

    document.getElementById("paymentTenant").addEventListener("change", (e) => {
      const tenant = state.tenants.find((t) => t.id === e.target.value);
      const dueInput = document.getElementById("paymentDue");
      if (tenant && (!dueInput.value || Number(dueInput.value) === 0)) dueInput.value = tenant.rent_amount;
    });

    document.addEventListener("profileready", init, { once: true });
  });

  /* ---------------- Workflow: online reference fields ---------------- */
  const ONLINE_METHODS = new Set([
    "UPI", "Bank Transfer", "IMPS", "NEFT", "RTGS", "Credit Card", "Debit Card", "Wallet",
  ]);

  function toggleWorkflowFields() {
    const method = document.getElementById("payMethod").value;
    document.getElementById("payReferenceField").hidden = !ONLINE_METHODS.has(method);
    document.getElementById("payReceiverField").hidden = method !== "Cash";
  }

  /* ---------------- Payment type tab helper ---------------- */
  function bindTypeTabs(tabsId, hiddenInputId, noteFieldId) {
    const tabs = document.getElementById(tabsId);
    if (!tabs) return;
    tabs.addEventListener("click", (event) => {
      const tab = event.target.closest(".tab");
      if (!tab) return;
      tabs.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(hiddenInputId).value = tab.dataset.type;
      document.getElementById(noteFieldId).hidden = tab.dataset.type !== "Hybrid";
    });
  }

  function resetTypeTabs(tabsId, hiddenInputId, noteFieldId, noteInputId, value, note) {
    const tabs = document.getElementById(tabsId);
    tabs.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.type === value));
    document.getElementById(hiddenInputId).value = value;
    document.getElementById(noteFieldId).hidden = value !== "Hybrid";
    document.getElementById(noteInputId).value = note || "";
  }

  async function init() {
    await loadTenants();
    load();
  }

  async function loadTenants() {
    try {
      const data = await API.get("/api/tenants", { active: "true" });
      state.tenants = data.items;
      document.getElementById("paymentTenant").innerHTML =
        '<option value="">Select a leaseholder</option>' +
        state.tenants
          .map((t) => {
            const property = t.properties ? " · " + t.properties.name : "";
            return '<option value="' + t.id + '">' + UI.escapeHtml(t.name + property) + "</option>";
          })
          .join("");
    } catch (error) {
      UI.toast("Could not load leaseholders: " + error.message, "error");
    }
  }

  async function load() {
    const container = document.getElementById("paymentTable");
    UI.showLoader(container);
    try {
      const data = await API.get("/api/payments", {
        search: state.search, status: state.status, month: state.month,
      });
      state.items = data.items;
      renderTotals(data.totals);
      render(container, data.items);
    } catch (error) {
      UI.toast(error.message, "error");
      UI.emptyState(container, { icon: "&#9888;", title: "Could not load payments", message: error.message });
    }
  }

  function renderTotals(totals) {
    const card = (label, value, icon, tone, sub) =>
      '<article class="stat-card"><div class="stat-top">' +
      '<span class="stat-label">' + label + '</span>' +
      '<span class="stat-icon ' + tone + '">' + icon + "</span></div>" +
      '<div class="stat-value">' + UI.compactMoney(value) + "</div>" +
      '<div class="stat-sub">' + sub + "</div></article>";

    document.getElementById("paymentTotals").innerHTML =
      card("Total billed", totals.due, "&#128179;", "", "Across the current filter") +
      card("Total collected", totals.paid, "&#9989;", "green", "Rent received") +
      card("Still pending", totals.pending, "&#9203;", "red", "Outstanding balance");
  }

  function statusBadge(status) {
    const map = { Paid: "badge-success", Partial: "badge-warn", Pending: "badge-danger" };
    return '<span class="badge ' + (map[status] || "badge-muted") + '">' + UI.escapeHtml(status) + "</span>";
  }

  /* Cash = amber, Online = green, Hybrid = blue(info) */
  function typeBadge(type) {
    const map = { Cash: "badge-warn", Online: "badge-success", Hybrid: "badge-info", "Mixed Payment": "badge-info" };
    return '<span class="badge ' + (map[type] || "badge-muted") + '">' + UI.escapeHtml(type || "—") + "</span>";
  }

  /* Compares the payment date's day-of-month against the tenant's due day. */
  function lateStatus(row) {
    const dueDay = row.tenants ? row.tenants.due_day_of_month : null;
    if (!row.payment_date || !dueDay) return "";
    const paidDate = new Date(row.payment_date + "T00:00:00");
    if (Number.isNaN(paidDate.getTime())) return "";
    const paidDay = paidDate.getDate();
    // Compare against the due day within the same month the rent covers.
    const monthDate = new Date(String(row.period_month || "").slice(0, 10) + "T00:00:00");
    const dueDate = new Date(monthDate.getFullYear(), monthDate.getMonth(), Math.min(dueDay, 28));
    if (paidDate <= dueDate) {
      return '<span class="badge badge-success">On time</span>';
    }
    const daysLate = Math.round((paidDate - dueDate) / 86400000);
    return '<span class="badge badge-danger">Late by ' + daysLate + "d</span>";
  }

  function render(container, items) {
    if (!items.length) {
      UI.emptyState(container, {
        icon: "&#128181;",
        title: state.search || state.status !== "all" || state.month ? "No matching records" : "No rent records yet",
        message: state.search || state.status !== "all" || state.month
          ? "Try clearing the filters to see all rent records."
          : 'Use "Generate month" to create pending rent records for all active leaseholders.',
        actionId: "emptyGenerate",
        actionLabel: "Generate this month",
      });
      const button = document.getElementById("emptyGenerate");
      if (button) button.addEventListener("click", openGenerate);
      return;
    }

    container.innerHTML =
      "<table><thead><tr><th>Leaseholder</th><th>Property</th><th>Month</th>" +
      '<th class="text-right">Due</th><th class="text-right">Paid</th><th class="text-right">Balance</th>' +
      "<th>Type</th><th>Status</th><th>Paid on</th>" +
      '<th class="text-right">Actions</th></tr></thead><tbody>' +
      items
        .map((row) => {
          const balance = Math.max(Number(row.amount_due || 0) - Number(row.amount_paid || 0), 0);
          const tenant = row.tenants ? row.tenants.name : "Unknown";
          const property = row.properties ? row.properties.name : "—";
          return (
            "<tr>" +
            '<td data-label="Leaseholder"><span class="cell-title">' + UI.escapeHtml(tenant) + "</span></td>" +
            '<td data-label="Property">' + UI.escapeHtml(property) + "</td>" +
            '<td data-label="Month">' + UI.formatMonth(row.period_month) + "</td>" +
            '<td class="text-right num" data-label="Due">' + UI.money(row.amount_due) + "</td>" +
            '<td class="text-right num" data-label="Paid">' + UI.money(row.amount_paid) + "</td>" +
            '<td class="text-right num" data-label="Balance" style="color:' + (balance > 0 ? "var(--danger)" : "var(--success)") + '">' +
              UI.money(balance) + "</td>" +
            '<td data-label="Type">' + typeBadge(row.payment_type) + "</td>" +
            '<td data-label="Status">' + statusBadge(row.status) + "</td>" +
            '<td data-label="Paid on">' + UI.formatDate(row.payment_date) + "</td>" +
            '<td data-label="Actions"><div class="cell-actions">' +
              (row.status !== "Paid"
                ? '<button class="btn btn-primary btn-sm" data-pay="' + row.id + '">Mark paid</button>'
                : "") +
              '<button class="btn btn-ghost btn-sm" data-view="' + row.id + '">Details</button>' +
              (Number(row.amount_paid || 0) > 0
                ? '<button class="btn btn-ghost btn-sm" data-receipt="' + row.id + '">Receipt</button>'
                : "") +
              '<button class="btn btn-ghost btn-sm" data-edit="' + row.id + '">Edit</button>' +
              '<button class="btn btn-danger btn-sm" data-delete="' + row.id + '">Delete</button>' +
            "</div></td></tr>"
          );
        })
        .join("") +
      "</tbody></table>";

    container.querySelectorAll("[data-pay]").forEach((b) =>
      b.addEventListener("click", () => openPay(b.dataset.pay))
    );
    container.querySelectorAll("[data-view]").forEach((b) =>
      b.addEventListener("click", () => openHistory(b.dataset.view))
    );
    container.querySelectorAll("[data-receipt]").forEach((b) =>
      b.addEventListener("click", () => downloadReceipt(b.dataset.receipt))
    );
    container.querySelectorAll("[data-edit]").forEach((b) =>
      b.addEventListener("click", () => openForm(b.dataset.edit))
    );
    container.querySelectorAll("[data-delete]").forEach((b) =>
      b.addEventListener("click", () => remove(b.dataset.delete))
    );
  }

  /* ---------------- Workflow: receipt download ---------------- */
  async function downloadReceipt(id) {
    try {
      const response = await fetch(API.url("/api/payments/" + id + "/receipt"), { credentials: API.credentials, headers: API.authHeaders() });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || "No receipt is available for this record yet.");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "receipt-" + id + ".pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      UI.toast(error.message, "error");
    }
  }

  /* ---------------- Workflow: reminder / payment timeline ---------------- */
  async function renderTimeline(id) {
    const container = document.getElementById("historyTimeline");
    if (!container) return;
    container.innerHTML = '<div class="loader-block"><span class="spinner"></span></div>';
    try {
      const result = await API.get("/api/payments/" + id + "/timeline");
      const items = result.items || [];
      if (!items.length) {
        container.innerHTML = '<p class="muted">No reminders or payment activity recorded yet.</p>';
        return;
      }
      const icon = { reminder: "\u23f0", payment: "\u2713", audit: "\u2022", credit: "\u2728" };
      container.innerHTML =
        '<ul class="workflow-timeline">' +
        items
          .map(
            (e) =>
              '<li class="timeline-item timeline-' + e.type + '">' +
              '<span class="timeline-dot">' + (icon[e.type] || "\u2022") + "</span>" +
              '<div><div class="timeline-label">' + UI.escapeHtml(e.label) + "</div>" +
              '<div class="timeline-time">' + UI.formatDate(e.at) + "</div></div></li>"
          )
          .join("") +
        "</ul>";
    } catch (error) {
      container.innerHTML = '<p class="muted">Could not load timeline: ' + UI.escapeHtml(error.message) + "</p>";
    }
  }

  /* ---------------- Payment history / details drawer ---------------- */
  function openHistory(id) {
    const row = state.items.find((r) => r.id === id);
    if (!row) return UI.toast("Record not found. Refresh the page.", "error");

    const tenant = row.tenants ? row.tenants.name : "Unknown";
    const property = row.properties ? row.properties.name : "—";
    const dueDay = row.tenants ? row.tenants.due_day_of_month : null;
    const balance = Math.max(Number(row.amount_due || 0) - Number(row.amount_paid || 0), 0);

    document.getElementById("historyBody").innerHTML =
      '<div class="grid-2">' +
        '<div class="pay-summary"><div><b>Leaseholder</b></div><div>' + UI.escapeHtml(tenant) + "</div></div>" +
        '<div class="pay-summary"><div><b>Property</b></div><div>' + UI.escapeHtml(property) + "</div></div>" +
      "</div>" +
      '<div class="grid-2" style="margin-top:12px;">' +
        '<div class="pay-summary"><div><b>Rent month</b></div><div>' + UI.formatMonth(row.period_month) + "</div></div>" +
        '<div class="pay-summary"><div><b>Due day of month</b></div><div>' + (dueDay || "—") + "</div></div>" +
      "</div>" +
      '<div class="grid-2" style="margin-top:12px;">' +
        '<div class="pay-summary"><div><b>Payment date</b></div><div>' + UI.formatDate(row.payment_date) + "</div></div>" +
        '<div class="pay-summary"><div><b>On-time status</b></div><div>' + (lateStatus(row) || "—") + "</div></div>" +
      "</div>" +
      '<div class="grid-2" style="margin-top:12px;">' +
        '<div class="pay-summary"><div><b>Payment type</b></div><div>' + typeBadge(row.payment_type) + "</div></div>" +
        '<div class="pay-summary"><div><b>Payment method</b></div><div>' + UI.escapeHtml(row.payment_method || "—") + "</div></div>" +
      "</div>" +
      ((row.payment_type === "Hybrid" || row.payment_type === "Mixed Payment") && row.payment_type_note
        ? '<div class="pay-summary" style="margin-top:12px;"><div><b>Payment breakdown</b></div><div>' +
          UI.escapeHtml(row.payment_type_note) + "</div></div>"
        : "") +
      '<div class="grid-2" style="margin-top:12px;">' +
        '<div class="pay-summary"><div><b>Amount due</b></div><div>' + UI.money(row.amount_due) + "</div></div>" +
        '<div class="pay-summary"><div><b>Amount paid</b></div><div>' + UI.money(row.amount_paid) + "</div></div>" +
      "</div>" +
      '<div class="pay-summary" style="margin-top:12px;"><div><b>Balance</b></div><div style="color:' +
        (balance > 0 ? "var(--danger)" : "var(--success)") + '">' + UI.money(balance) + "</div></div>" +
      (row.tenants && Number(row.tenants.advance_balance || 0) > 0
        ? '<div class="pay-summary" style="margin-top:12px;"><div><b>Advance credit on account</b></div><div style="color:var(--brand-500);">' +
          UI.money(row.tenants.advance_balance) + " (auto-applied to future rent)</div></div>"
        : "") +
      (row.notes
        ? '<div class="pay-summary" style="margin-top:12px;"><div><b>Notes</b></div><div>' +
          UI.escapeHtml(row.notes) + "</div></div>"
        : "") +
      '<div class="modal-foot" style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border);">' +
        (Number(row.amount_paid || 0) > 0
          ? '<button type="button" class="btn btn-soft btn-sm" id="historyReceiptBtn">Download receipt</button>'
          : "") +
      "</div>" +
      '<h3 class="workflow-section-title">Reminder &amp; payment timeline</h3>' +
      '<div id="historyTimeline"></div>';

    const receiptBtn = document.getElementById("historyReceiptBtn");
    if (receiptBtn) receiptBtn.addEventListener("click", () => downloadReceipt(row.id));

    UI.openModal("historyModal");
    renderTimeline(row.id);
  }

  function openForm(id) {
    const form = document.getElementById("paymentForm");
    form.reset();
    document.getElementById("paymentId").value = "";
    document.getElementById("paymentMonth").value = UI.monthInputValue(0);
    document.getElementById("paymentModalTitle").textContent = id ? "Edit rent record" : "New rent record";
    resetTypeTabs("paymentTypeTabs", "paymentType", "paymentTypeNoteField", "paymentTypeNote", "Cash", "");

    if (id) {
      const row = state.items.find((r) => r.id === id);
      if (!row) return UI.toast("Record not found. Refresh the page.", "error");
      document.getElementById("paymentId").value = row.id;
      document.getElementById("paymentTenant").value = row.tenant_id || "";
      document.getElementById("paymentMonth").value = String(row.period_month || "").slice(0, 7);
      document.getElementById("paymentDue").value = row.amount_due || 0;
      document.getElementById("paymentPaid").value = row.amount_paid || 0;
      document.getElementById("paymentDate").value = row.payment_date || "";
      document.getElementById("paymentMethod").value = row.payment_method || "";
      document.getElementById("paymentNotes").value = row.notes || "";
      resetTypeTabs(
        "paymentTypeTabs", "paymentType", "paymentTypeNoteField", "paymentTypeNote",
        row.payment_type || "Cash", row.payment_type_note || ""
      );
    }
    UI.openModal("paymentModal");
  }

  async function save(event) {
    event.preventDefault();
    const button = document.getElementById("paymentSubmit");
    const id = document.getElementById("paymentId").value;

    const paymentType = document.getElementById("paymentType").value;
    const paymentTypeNote = document.getElementById("paymentTypeNote").value.trim() || null;

    const payload = {
      tenant_id: document.getElementById("paymentTenant").value,
      period_month: document.getElementById("paymentMonth").value,
      amount_due: parseFloat(document.getElementById("paymentDue").value || "0"),
      amount_paid: parseFloat(document.getElementById("paymentPaid").value || "0"),
      payment_date: document.getElementById("paymentDate").value || null,
      payment_method: document.getElementById("paymentMethod").value || null,
      payment_type: paymentType,
      payment_type_note: paymentTypeNote,
      notes: document.getElementById("paymentNotes").value.trim() || null,
    };

    if (!payload.tenant_id) return UI.toast("Please select a tenant.", "error");
    if (!payload.period_month) return UI.toast("Please choose a rent month.", "error");
    if (payload.amount_paid > payload.amount_due) {
      return UI.toast("Paid amount cannot be greater than the amount due.", "error");
    }
    if (paymentType === "Hybrid" && !paymentTypeNote) {
      return UI.toast("Please add a breakdown note for a hybrid payment.", "error");
    }

    UI.setButtonLoading(button, true);
    try {
      if (id) await API.put("/api/payments/" + id, payload);
      else await API.post("/api/payments", payload);
      UI.toast(id ? "Rent record updated." : "Rent record created.", "success");
      UI.closeModal("paymentModal");
      load();
    } catch (error) {
      UI.toast(error.message, "error");
    } finally {
      UI.setButtonLoading(button, false);
    }
  }

  function openPay(id) {
    const row = state.items.find((r) => r.id === id);
    if (!row) return UI.toast("Record not found. Refresh the page.", "error");

    const balance = Math.max(Number(row.amount_due || 0) - Number(row.amount_paid || 0), 0);
    document.getElementById("payRecordId").value = row.id;
    document.getElementById("paySummary").innerHTML =
      "<div><b>" + UI.escapeHtml(row.tenants ? row.tenants.name : "Leaseholder") + "</b> · " +
        UI.formatMonth(row.period_month) + "</div>" +
      "<div>Amount due: <b>" + UI.money(row.amount_due) + "</b></div>" +
      "<div>Already paid: <b>" + UI.money(row.amount_paid) + "</b></div>" +
      "<div>Balance: <b style='color:var(--danger)'>" + UI.money(balance) + "</b></div>" +
      (row.tenants && row.tenants.due_day_of_month
        ? "<div>Rent due day: <b>" + row.tenants.due_day_of_month + "</b></div>"
        : "");

    document.getElementById("payAmount").value = row.amount_due;
    document.getElementById("payAmount").removeAttribute("max"); // overpayments are allowed (carried forward as advance credit)
    document.getElementById("payDate").value = UI.todayInputValue();
    document.getElementById("payMethod").value = row.payment_method || "Cash";
    document.getElementById("payReference").value = "";
    document.getElementById("payReceiver").value = "";
    document.getElementById("payNotes").value = "";
    resetTypeTabs("payTypeTabs", "payType", "payTypeNoteField", "payTypeNote", "Cash", "");
    toggleWorkflowFields();
    UI.openModal("payModal");
  }

  async function confirmPayment(event) {
    event.preventDefault();
    const button = document.getElementById("paySubmit");
    const id = document.getElementById("payRecordId").value;

    const method = document.getElementById("payMethod").value;
    const paymentType = document.getElementById("payType").value;
    const paymentTypeNote = document.getElementById("payTypeNote").value.trim() || null;
    const amount = parseFloat(document.getElementById("payAmount").value || "0");
    const paymentDate = document.getElementById("payDate").value;
    const reference = document.getElementById("payReference").value.trim() || null;
    const receiver = document.getElementById("payReceiver").value.trim() || null;
    const notes = document.getElementById("payNotes").value.trim() || null;

    if (!paymentDate) return UI.toast("Please select a payment date.", "error");
    if (!amount || amount <= 0) return UI.toast("Enter an amount received greater than zero.", "error");
    if (ONLINE_METHODS.has(method) && !reference) {
      return UI.toast("Enter a transaction ID, UTR, or reference number for this payment method.", "error");
    }
    if (paymentType === "Mixed Payment" && !paymentTypeNote) {
      return UI.toast("Please add a breakdown note for a mixed payment.", "error");
    }

    // Workflow: itemized payment entry -> auto-generates a receipt, schedules
    // the next rent cycle when fully paid, and pushes an in-app notification.
    const entry = { method, amount, notes: notes || undefined };
    if (ONLINE_METHODS.has(method)) entry.transaction_id = reference;
    if (method === "Cash" && receiver) entry.receiver_name = receiver;

    UI.setButtonLoading(button, true);
    try {
      const result = await API.post("/api/payments/" + id + "/record", { entries: [entry], notes });
      const status = result.payment ? result.payment.status : "Updated";
      let message;
      if (result.advance_credit > 0) {
        message = "Payment confirmed in full. Rs. " + result.advance_credit.toLocaleString("en-IN", { minimumFractionDigits: 2 }) +
          " extra carried forward as advance credit for next month.";
      } else if (status === "Paid") {
        message = "Payment confirmed in full. Receipt " + result.receipt_number + " generated.";
      } else {
        message = "Partial payment recorded. Remaining balance: " + UI.money(result.remaining) + ".";
      }
      UI.toast(message, "success");
      UI.closeModal("payModal");
      load();
    } catch (error) {
      UI.toast(error.message, "error");
    } finally {
      UI.setButtonLoading(button, false);
    }
  }

  function openGenerate() {
    document.getElementById("generateMonth").value = UI.monthInputValue(0);
    UI.openModal("generateModal");
  }

  async function generate(event) {
    event.preventDefault();
    const button = document.getElementById("generateSubmit");
    const month = document.getElementById("generateMonth").value;
    if (!month) return UI.toast("Please choose a month.", "error");

    UI.setButtonLoading(button, true);
    try {
      const result = await API.post("/api/payments/generate", { period_month: month });
      UI.toast(result.message, "success", "Records generated");
      UI.closeModal("generateModal");
      load();
    } catch (error) {
      UI.toast(error.message, "error");
    } finally {
      UI.setButtonLoading(button, false);
    }
  }

  async function downloadReport(event) {
    event.preventDefault();
    const button = document.getElementById("reportSubmit");
    const range = document.getElementById("reportRange").value;

    UI.setButtonLoading(button, true);
    try {
      const response = await fetch(API.url("/api/payments/report?range=" + encodeURIComponent(range)), {
        method: "GET",
        credentials: API.credentials,
        headers: API.authHeaders(),
      });

      if (!response.ok) {
        let message = "Could not generate the report (" + response.status + ").";
        try {
          const err = await response.json();
          if (err && err.detail) message = typeof err.detail === "string" ? err.detail : JSON.stringify(err.detail);
        } catch (e) { /* response wasn't JSON, keep default message */ }
        throw new Error(message);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "rentflow-report-" + range + "-" + UI.todayInputValue() + ".pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      UI.toast("Report downloaded.", "success");
      UI.closeModal("reportModal");
    } catch (error) {
      UI.toast(error.message, "error");
    } finally {
      UI.setButtonLoading(button, false);
    }
  }

  async function remove(id) {
    if (!UI.confirmAction("Delete this rent record? This cannot be undone.")) return;
    try {
      await API.del("/api/payments/" + id);
      UI.toast("Rent record deleted.", "success");
      load();
    } catch (error) {
      UI.toast(error.message, "error");
    }
  }
})();