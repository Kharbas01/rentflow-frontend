/* Reports module: report picker, filters, table, PDF/Excel/print export. */
(function () {
  const state = {
    type: "properties",
    properties: [],
    tenants: [],
    filters: { search: "", date_from: "", date_to: "", property_id: "all", tenant_id: "all", payment_status: "all", agreement_status: "all" },
  };

  const PAYMENT_STATUS_TYPES = new Set(["rent-collection", "pending-rent", "overdue-rent"]);
  const AGREEMENT_STATUS_TYPES = new Set(["agreements", "agreement-renewals", "agreement-expiry"]);

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("reportTypeSelect").addEventListener("change", (e) => {
      state.type = e.target.value;
      updateFilterVisibility();
      load();
    });

    document.getElementById("reportSearch").addEventListener(
      "input",
      UI.debounce((e) => { state.filters.search = e.target.value.trim(); load(); }, 320)
    );
    document.getElementById("reportDateFrom").addEventListener("change", (e) => { state.filters.date_from = e.target.value; load(); });
    document.getElementById("reportDateTo").addEventListener("change", (e) => { state.filters.date_to = e.target.value; load(); });
    document.getElementById("reportPropertyFilter").addEventListener("change", (e) => { state.filters.property_id = e.target.value; load(); });
    document.getElementById("reportTenantFilter").addEventListener("change", (e) => { state.filters.tenant_id = e.target.value; load(); });
    document.getElementById("reportPaymentStatusFilter").addEventListener("change", (e) => { state.filters.payment_status = e.target.value; load(); });
    document.getElementById("reportAgreementStatusFilter").addEventListener("change", (e) => { state.filters.agreement_status = e.target.value; load(); });
    document.getElementById("reportClearFilters").addEventListener("click", clearFilters);

    document.getElementById("reportDownloadPdf").addEventListener("click", () => downloadFile("pdf"));
    document.getElementById("reportDownloadExcel").addEventListener("click", () => downloadFile("excel"));
    document.getElementById("reportPrint").addEventListener("click", () => window.print());

    document.addEventListener("profileready", init, { once: true });
  });

  function clearFilters() {
    state.filters = { search: "", date_from: "", date_to: "", property_id: "all", tenant_id: "all", payment_status: "all", agreement_status: "all" };
    document.getElementById("reportSearch").value = "";
    document.getElementById("reportDateFrom").value = "";
    document.getElementById("reportDateTo").value = "";
    document.getElementById("reportPropertyFilter").value = "all";
    document.getElementById("reportTenantFilter").value = "all";
    document.getElementById("reportPaymentStatusFilter").value = "all";
    document.getElementById("reportAgreementStatusFilter").value = "all";
    load();
  }

  function updateFilterVisibility() {
    document.getElementById("reportPaymentStatusFilter").hidden = !PAYMENT_STATUS_TYPES.has(state.type);
    document.getElementById("reportAgreementStatusFilter").hidden = !AGREEMENT_STATUS_TYPES.has(state.type);
  }

  async function init() {
    try {
      const meta = await API.get("/api/reports/meta");
      state.properties = meta.properties || [];
      state.tenants = meta.tenants || [];

      const typeSelect = document.getElementById("reportTypeSelect");
      typeSelect.innerHTML = meta.report_types.map((t) => '<option value="' + t.key + '">' + UI.escapeHtml(t.label) + "</option>").join("");
      state.type = meta.report_types[0] ? meta.report_types[0].key : "properties";

      const propSelect = document.getElementById("reportPropertyFilter");
      propSelect.innerHTML = '<option value="all">All properties</option>' +
        state.properties.map((p) => '<option value="' + p.id + '">' + UI.escapeHtml(p.name) + "</option>").join("");

      const tenantSelect = document.getElementById("reportTenantFilter");
      tenantSelect.innerHTML = '<option value="all">All tenants</option>' +
        state.tenants.map((t) => '<option value="' + t.id + '">' + UI.escapeHtml(t.name) + "</option>").join("");

      updateFilterVisibility();
      load();
    } catch (error) {
      UI.toast(error.message, "error");
    }
  }

  function buildQuery() {
    const f = state.filters;
    return {
      date_from: f.date_from || undefined,
      date_to: f.date_to || undefined,
      property_id: f.property_id,
      tenant_id: f.tenant_id,
      payment_status: f.payment_status,
      agreement_status: f.agreement_status,
      search: f.search || undefined,
    };
  }

  async function load() {
    const cardsEl = document.getElementById("reportCards");
    const tableEl = document.getElementById("reportTable");
    cardsEl.innerHTML = '<div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div>';
    tableEl.innerHTML = '<div class="loader-block"><span class="spinner"></span></div>';

    try {
      const report = await API.get("/api/reports/" + state.type, buildQuery());
      document.getElementById("reportTitle").textContent = report.title;
      document.getElementById("reportSubtitle").textContent = report.rows.length + " record(s)";

      if (report.unavailable) {
        cardsEl.innerHTML = "";
        UI.emptyState(tableEl, { icon: "&#8505;", title: "Not set up yet", message: report.unavailable });
        return;
      }

      renderCards(cardsEl, report.cards);
      renderTable(tableEl, report.columns, report.rows);
    } catch (error) {
      cardsEl.innerHTML = "";
      UI.emptyState(tableEl, { icon: "&#9888;", title: "Could not load report", message: error.message });
    }
  }

  function renderCards(container, cards) {
    if (!cards || !cards.length) { container.innerHTML = ""; return; }
    container.innerHTML = cards
      .map(
        (c) =>
          '<article class="stat-card"><div class="stat-top"><span class="stat-label">' + UI.escapeHtml(c.label) + "</span></div>" +
          '<div class="stat-value">' + (c.money ? UI.money(c.value) : UI.escapeHtml(String(c.value))) + "</div></article>"
      )
      .join("");
  }

  function renderTable(container, columns, rows) {
    if (!columns || !columns.length || !rows.length) {
      UI.emptyState(container, { icon: "&#128203;", title: "No matching records", message: "Try widening the date range or clearing filters." });
      return;
    }
    container.innerHTML =
      "<table><thead><tr>" +
      columns.map((c) => '<th class="' + (c.type === "money" ? "text-right" : "") + '">' + UI.escapeHtml(c.label) + "</th>").join("") +
      "</tr></thead><tbody>" +
      rows
        .map(
          (row) =>
            "<tr>" +
            columns
              .map((c) => {
                const value = row[c.key];
                const display = c.type === "money" ? UI.money(value) : UI.escapeHtml(value === null || value === undefined ? "\u2014" : String(value));
                return '<td data-label="' + UI.escapeHtml(c.label) + '" class="' + (c.type === "money" ? "text-right num" : "") + '">' + display + "</td>";
              })
              .join("") +
            "</tr>"
        )
        .join("") +
      "</tbody></table>";
  }

  async function downloadFile(kind) {
    const query = new URLSearchParams();
    const q = buildQuery();
    Object.keys(q).forEach((key) => { if (q[key] !== undefined && q[key] !== "all") query.append(key, q[key]); });
    const url = "/api/reports/" + state.type + "/" + kind + "?" + query.toString();

    try {
      const response = await fetch(API.url(url), { credentials: API.credentials, headers: API.authHeaders() });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || "Could not generate the file.");
      }
      const blob = await response.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = state.type + "-report." + (kind === "excel" ? "xlsx" : "pdf");
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(objectUrl);
    } catch (error) {
      UI.toast(error.message, "error");
    }
  }
})();
