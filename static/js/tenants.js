/* Tenant management: list, search, filter, create, edit, delete. */
(function () {
  const state = { items: [], properties: [], search: "", active: "all" };

  document.addEventListener("DOMContentLoaded", () => {
    UI.bindModalClose("tenantModal");

    document.getElementById("addTenantBtn").addEventListener("click", () => openForm());
    document.getElementById("tenantForm").addEventListener("submit", save);

    document.getElementById("tenantSearch").addEventListener(
      "input",
      UI.debounce((event) => { state.search = event.target.value.trim(); load(); }, 320)
    );
    document.getElementById("tenantActiveFilter").addEventListener("change", (event) => {
      state.active = event.target.value;
      load();
    });

    document.addEventListener("profileready", init, { once: true });
  });

  async function init() {
    await loadProperties();
    load();
  }

  async function loadProperties() {
    try {
      const data = await API.get("/api/properties");
      state.properties = data.items;
      const select = document.getElementById("tenantProperty");
      select.innerHTML =
        '<option value="">— Not assigned —</option>' +
        state.properties
          .map((p) => '<option value="' + p.id + '">' + UI.escapeHtml(p.name) + " (" + UI.escapeHtml(p.type) + ")</option>")
          .join("");
    } catch (error) {
      UI.toast("Could not load properties: " + error.message, "error");
    }
  }

  async function load() {
    const container = document.getElementById("tenantTable");
    UI.showLoader(container);
    try {
      const data = await API.get("/api/tenants", { search: state.search, active: state.active });
      state.items = data.items;
      render(container, data.items);
    } catch (error) {
      UI.toast(error.message, "error");
      UI.emptyState(container, { icon: "&#9888;", title: "Could not load tenants", message: error.message });
    }
  }

  function agreementCell(tenant) {
    if (!tenant.agreement_start && !tenant.agreement_end) return "—";
    return UI.formatDate(tenant.agreement_start) + " → " + UI.formatDate(tenant.agreement_end);
  }

  function ordinal(day) {
    if (!day) return "—";
    const n = Number(day);
    const suffix = ["th", "st", "nd", "rd"];
    const mod100 = n % 100;
    return n + (suffix[(mod100 - 20) % 10] || suffix[mod100] || suffix[0]) + " of month";
  }

  function agreementStatus(t) {
    if (!t.agreement_end) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const end = new Date(t.agreement_end + "T00:00:00");
    const daysLeft = Math.round((end - today) / 86400000);
    if (daysLeft < 0) return { label: "Expired", cls: "badge-danger" };
    if (daysLeft <= 30) return { label: "Expiring soon", cls: "badge-warn" };
    return { label: "Active agreement", cls: "badge-success" };
  }

  function detailBadges(t) {
    const badges = [];
    badges.push('<span class="badge badge-info" title="Rent due day of month">Due: ' + ordinal(t.due_day_of_month) + "</span>");
    if (t.agreement_duration_months) {
      badges.push('<span class="badge badge-muted" title="Agreement duration">' + t.agreement_duration_months + " mo</span>");
    }
    if (t.rent_increase_percentage && Number(t.rent_increase_percentage) > 0) {
      badges.push('<span class="badge badge-warn" title="Rent increase per cycle">+' + Number(t.rent_increase_percentage) + "%</span>");
    }
    const status = agreementStatus(t);
    if (status) {
      badges.push('<span class="badge ' + status.cls + '" title="Agreement status">' + status.label + "</span>");
    }
    badges.push('<span class="badge badge-success" title="Current active rent">' + UI.money(t.rent_amount) + "</span>");
    if (t.next_rent_increase_date && Number(t.rent_increase_percentage) > 0) {
      badges.push('<span class="badge badge-info" title="Next automatic rent increase">Next hike: ' + UI.formatDate(t.next_rent_increase_date) + "</span>");
    }
    return '<div class="cell-actions" style="justify-content:flex-start;flex-wrap:wrap;gap:4px;margin-top:4px;">' + badges.join("") + "</div>";
  }

  function render(container, items) {
    if (!items.length) {
      UI.emptyState(container, {
        icon: "&#128100;",
        title: state.search || state.active !== "all" ? "No matching tenants" : "No tenants yet",
        message: state.search || state.active !== "all"
          ? "Try a different search term or clear the filters."
          : "Add a leaseholder and assign them to one of your properties.",
        actionId: "emptyAddTenant",
        actionLabel: "+ Add leaseholder",
      });
      const button = document.getElementById("emptyAddTenant");
      if (button) button.addEventListener("click", () => openForm());
      return;
    }

    container.innerHTML =
      "<table><thead><tr><th>Leaseholder</th><th>Contact</th><th>Property</th><th>Agreement</th>" +
      '<th class="text-right">Rent</th><th class="text-right">Deposit</th><th>Status</th>' +
      '<th class="text-right">Actions</th></tr></thead><tbody>' +
      items
        .map((t) => {
          const property = t.properties ? t.properties.name : "Not assigned";
          return (
            "<tr>" +
            '<td data-label="Leaseholder"><span class="cell-title">' + UI.escapeHtml(t.name) + "</span>" + detailBadges(t) + "</td>" +
            '<td data-label="Contact">' + UI.escapeHtml(t.phone || "—") +
              '<span class="cell-sub">' + UI.escapeHtml(t.email || "") + "</span></td>" +
            '<td data-label="Property">' + UI.escapeHtml(property) + "</td>" +
            '<td data-label="Agreement"><span class="cell-sub">' + agreementCell(t) + "</span></td>" +
            '<td class="text-right num" data-label="Rent">' + UI.money(t.rent_amount) + "</td>" +
            '<td class="text-right num" data-label="Deposit">' + UI.money(t.security_deposit) + "</td>" +
            '<td data-label="Status"><span class="badge ' + (t.is_active ? "badge-success" : "badge-muted") + '">' +
              (t.is_active ? "Active" : "Inactive") + "</span></td>" +
            '<td data-label="Actions"><div class="cell-actions">' +
              '<button class="btn btn-ghost btn-sm" data-edit="' + t.id + '">Edit</button>' +
              '<button class="btn btn-danger btn-sm" data-delete="' + t.id + '">Delete</button>' +
            "</div></td></tr>"
          );
        })
        .join("") +
      "</tbody></table>";

    container.querySelectorAll("[data-edit]").forEach((b) =>
      b.addEventListener("click", () => openForm(b.dataset.edit))
    );
    container.querySelectorAll("[data-delete]").forEach((b) =>
      b.addEventListener("click", () => remove(b.dataset.delete))
    );
  }

  function renderRentInfo(t) {
    const box = document.getElementById("tenantRentInfo");
    if (!box) return;
    if (!t) { box.hidden = true; box.innerHTML = ""; return; }

    const badges = [
      '<span class="badge badge-muted" title="Original rent when this leaseholder was created">Base: ' + UI.money(t.base_rent_amount ?? t.rent_amount) + "</span>",
      '<span class="badge badge-success" title="Current active rent">Current: ' + UI.money(t.rent_amount) + "</span>",
    ];
    if (t.next_rent_increase_date && Number(t.rent_increase_percentage) > 0) {
      badges.push('<span class="badge badge-info">Next increase: ' + UI.formatDate(t.next_rent_increase_date) + "</span>");
    }
    box.hidden = false;
    box.innerHTML =
      '<div class="cell-actions" style="justify-content:flex-start;flex-wrap:wrap;gap:6px;">' + badges.join("") + "</div>" +
      '<div id="tenantRentHistory" class="cell-sub" style="margin-top:6px;">Loading rent history…</div>';

    API.get("/api/tenants/" + t.id + "/rent-history")
      .then((data) => {
        const el = document.getElementById("tenantRentHistory");
        if (!el) return;
        if (!data.items.length) { el.textContent = "No rent increases recorded yet."; return; }
        el.innerHTML = "Rent history: " + data.items
          .map((h) => UI.money(h.previous_rent) + " → " + UI.money(h.new_rent) + " (" + UI.formatDate(h.increase_date) + ")")
          .join(", ");
      })
      .catch(() => {
        const el = document.getElementById("tenantRentHistory");
        if (el) el.textContent = "Could not load rent history.";
      });
  }

  // ---- Smart Agreement Duration: auto-calc end date, renewal date, remaining days ----
  const PRESET_MONTHS = new Set(["6", "11", "12", "24", "36", "48", "60"]);

  function selectedDurationMonths() {
    const select = document.getElementById("tenantDuration");
    if (select.value === "custom") {
      return parseInt(document.getElementById("tenantDurationCustom").value || "0", 10) || null;
    }
    return select.value ? parseInt(select.value, 10) : null;
  }

  function addMonths(dateStr, months) {
    const d = new Date(dateStr + "T00:00:00");
    d.setMonth(d.getMonth() + months);
    d.setDate(d.getDate() - 1); // agreement runs through the day before the same date next cycle
    return d.toISOString().slice(0, 10);
  }

  function recalcAgreementDates() {
    const startVal = document.getElementById("tenantStart").value;
    const months = selectedDurationMonths();
    if (startVal && months) {
      document.getElementById("tenantEnd").value = addMonths(startVal, months);
    }
    renderAgreementInfo();
  }

  function renderAgreementInfo() {
    const box = document.getElementById("tenantAgreementInfo");
    const endVal = document.getElementById("tenantEnd").value;
    if (!box) return;
    if (!endVal) { box.hidden = true; box.innerHTML = ""; return; }

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const end = new Date(endVal + "T00:00:00");
    const daysLeft = Math.round((end - today) / 86400000);
    const renewalDate = new Date(end); renewalDate.setDate(renewalDate.getDate() - 30);

    box.hidden = false;
    box.innerHTML =
      '<div class="cell-actions" style="justify-content:flex-start;flex-wrap:wrap;gap:6px;">' +
      '<span class="badge badge-info">Renewal reminder: ' + UI.formatDate(renewalDate.toISOString().slice(0, 10)) + "</span>" +
      '<span class="badge ' + (daysLeft < 0 ? "badge-danger" : daysLeft <= 30 ? "badge-warn" : "badge-success") + '">' +
      (daysLeft < 0 ? "Expired " + Math.abs(daysLeft) + " day(s) ago" : daysLeft + " day(s) remaining") +
      "</span></div>";
  }

  document.addEventListener("DOMContentLoaded", () => {
    const durationSelect = document.getElementById("tenantDuration");
    if (durationSelect) {
      durationSelect.addEventListener("change", () => {
        document.getElementById("tenantDurationCustomField").hidden = durationSelect.value !== "custom";
        recalcAgreementDates();
      });
    }
    const startInput = document.getElementById("tenantStart");
    if (startInput) startInput.addEventListener("change", recalcAgreementDates);
    const customInput = document.getElementById("tenantDurationCustom");
    if (customInput) customInput.addEventListener("input", recalcAgreementDates);
    const endInput = document.getElementById("tenantEnd");
    if (endInput) endInput.addEventListener("change", renderAgreementInfo);
  });

  function populateDurationField(t) {
    const select = document.getElementById("tenantDuration");
    const months = t.agreement_duration_months;
    document.getElementById("tenantDurationCustomField").hidden = true;
    document.getElementById("tenantDurationCustom").value = "";
    if (!months) {
      select.value = "";
    } else if (PRESET_MONTHS.has(String(months))) {
      select.value = String(months);
    } else {
      select.value = "custom";
      document.getElementById("tenantDurationCustomField").hidden = false;
      document.getElementById("tenantDurationCustom").value = months;
    }
  }

  function openForm(id) {
    const form = document.getElementById("tenantForm");
    form.reset();
    document.getElementById("tenantId").value = "";
    document.getElementById("tenantActive").checked = true;
    document.getElementById("tenantDueDay").value = 1;
    document.getElementById("tenantRentIncrease").value = 0;
    document.getElementById("tenantModalTitle").textContent = id ? "Edit leaseholder" : "New leaseholder";
    renderRentInfo(null);
    populateDurationField({});
    renderAgreementInfo();

    if (id) {
      const t = state.items.find((row) => row.id === id);
      if (!t) return UI.toast("Leaseholder not found. Refresh the page.", "error");
      document.getElementById("tenantId").value = t.id;
      document.getElementById("tenantName").value = t.name || "";
      document.getElementById("tenantPhone").value = t.phone || "";
      document.getElementById("tenantEmail").value = t.email || "";
      document.getElementById("tenantProperty").value = t.property_id || "";
      document.getElementById("tenantRent").value = t.rent_amount || 0;
      document.getElementById("tenantDeposit").value = t.security_deposit || 0;
      document.getElementById("tenantStart").value = t.agreement_start || "";
      document.getElementById("tenantEnd").value = t.agreement_end || "";
      document.getElementById("tenantDueDay").value = t.due_day_of_month || 1;
      populateDurationField(t);
      document.getElementById("tenantRentIncrease").value = t.rent_increase_percentage || 0;
      document.getElementById("tenantActive").checked = !!t.is_active;
      document.getElementById("tenantNotes").value = t.notes || "";
      renderRentInfo(t);
      renderAgreementInfo();
    }
    UI.openModal("tenantModal");
  }

  // Auto-fill rent from the selected property when creating a new leaseholder.
  document.addEventListener("change", (event) => {
    if (event.target.id !== "tenantProperty") return;
    const rentInput = document.getElementById("tenantRent");
    const chosen = state.properties.find((p) => p.id === event.target.value);
    if (chosen && (!rentInput.value || Number(rentInput.value) === 0)) {
      rentInput.value = chosen.monthly_rent;
    }
  });

  async function save(event) {
    event.preventDefault();
    const button = document.getElementById("tenantSubmit");
    const id = document.getElementById("tenantId").value;

    const durationRaw = selectedDurationMonths();

    const payload = {
      name: document.getElementById("tenantName").value.trim(),
      phone: document.getElementById("tenantPhone").value.trim() || null,
      email: document.getElementById("tenantEmail").value.trim() || null,
      property_id: document.getElementById("tenantProperty").value || null,
      rent_amount: parseFloat(document.getElementById("tenantRent").value || "0"),
      security_deposit: parseFloat(document.getElementById("tenantDeposit").value || "0"),
      agreement_start: document.getElementById("tenantStart").value || null,
      agreement_end: document.getElementById("tenantEnd").value || null,
      due_day_of_month: parseInt(document.getElementById("tenantDueDay").value || "1", 10),
      agreement_duration_months: durationRaw || null,
      rent_increase_percentage: parseFloat(document.getElementById("tenantRentIncrease").value || "0"),
      is_active: document.getElementById("tenantActive").checked,
      notes: document.getElementById("tenantNotes").value.trim() || null,
    };

    if (payload.name.length < 2) return UI.toast("Leaseholder name must be at least 2 characters.", "error");
    if (document.getElementById("tenantDuration").value === "custom" && !durationRaw) {
      return UI.toast("Enter a custom agreement duration in months.", "error");
    }
    if (payload.agreement_start && payload.agreement_end && payload.agreement_end < payload.agreement_start) {
      return UI.toast("Agreement end date must be after the start date.", "error");
    }
    if (payload.due_day_of_month < 1 || payload.due_day_of_month > 31) {
      return UI.toast("Rent due day must be between 1 and 31.", "error");
    }
    if (payload.rent_increase_percentage < 0 || payload.rent_increase_percentage > 100) {
      return UI.toast("Rent increase must be between 0 and 100%.", "error");
    }

    UI.setButtonLoading(button, true);
    try {
      if (id) await API.put("/api/tenants/" + id, payload);
      else await API.post("/api/tenants", payload);
      UI.toast(id ? "Leaseholder updated." : "Leaseholder added.", "success");
      UI.closeModal("tenantModal");
      await loadProperties();
      load();
    } catch (error) {
      UI.toast(error.message, "error");
    } finally {
      UI.setButtonLoading(button, false);
    }
  }

  async function remove(id) {
    const t = state.items.find((row) => row.id === id);
    const name = t ? t.name : "this tenant";
    if (!UI.confirmAction('Delete "' + name + '"? All their rent records will be removed too.')) return;

    try {
      await API.del("/api/tenants/" + id);
      UI.toast("Leaseholder deleted.", "success");
      await loadProperties();
      load();
    } catch (error) {
      UI.toast(error.message, "error");
    }
  }
})();