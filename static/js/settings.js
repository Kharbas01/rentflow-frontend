/* Settings: profile, currency, theme selection and password change. */
(function () {
  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("profileForm").addEventListener("submit", saveProfile);
    document.getElementById("passwordForm").addEventListener("submit", savePassword);
    document.getElementById("reminderSettingsForm").addEventListener("submit", saveReminderSettings);

    const options = document.getElementById("themeOptions");
    options.addEventListener("click", (event) => {
      const button = event.target.closest("[data-theme-choice]");
      if (!button) return;
      window.Theme.set(button.dataset.themeChoice);
      markActiveTheme();
      UI.toast("Theme updated.", "success");
    });

    markActiveTheme();
    document.addEventListener("profileready", loadProfile, { once: true });
    document.addEventListener("profileready", loadReminderSettings, { once: true });
  });

  /* ---------------- AI reminder workflow settings ---------------- */
  function parseDayList(value) {
    return (value || "")
      .split(",")
      .map((v) => parseInt(v.trim(), 10))
      .filter((v) => Number.isInteger(v) && v > 0 && v <= 60);
  }

  async function loadReminderSettings() {
    try {
      const settings = await API.get("/api/workflow/reminders/settings");
      document.getElementById("remindersEnabled").checked = settings.enabled !== false;
      document.getElementById("remindersBefore").value = (settings.before_days || []).join(", ");
      document.getElementById("remindersOnDue").checked = settings.remind_on_due_date !== false;
      document.getElementById("remindersAfter").value = (settings.after_days || []).join(", ");
      document.getElementById("remindersWeekly").checked = settings.weekly_until_paid !== false;
    } catch (error) {
      // Reminder settings are optional; fail quietly and keep the form defaults.
    }
  }

  async function saveReminderSettings(event) {
    event.preventDefault();
    const button = document.getElementById("reminderSettingsSubmit");
    const payload = {
      enabled: document.getElementById("remindersEnabled").checked,
      before_days: parseDayList(document.getElementById("remindersBefore").value),
      remind_on_due_date: document.getElementById("remindersOnDue").checked,
      after_days: parseDayList(document.getElementById("remindersAfter").value),
      weekly_until_paid: document.getElementById("remindersWeekly").checked,
    };

    UI.setButtonLoading(button, true);
    try {
      await API.put("/api/workflow/reminders/settings", payload);
      UI.toast("Reminder settings saved.", "success");
    } catch (error) {
      UI.toast(error.message, "error");
    } finally {
      UI.setButtonLoading(button, false);
    }
  }

  function markActiveTheme() {
    const current = window.Theme.get();
    document.querySelectorAll("[data-theme-choice]").forEach((button) => {
      button.classList.toggle("active", button.dataset.themeChoice === current);
    });
  }

  async function loadProfile() {
    try {
      const profile = await API.get("/api/settings/profile");
      document.getElementById("profileName").value = profile.full_name || "";
      document.getElementById("profileCompany").value = profile.company_name || "";
      document.getElementById("profilePhone").value = profile.phone || "";
      document.getElementById("profileCurrency").value = profile.currency || "INR";
      UI.setCurrency(profile.currency || "INR");
    } catch (error) {
      UI.toast(error.message, "error");
    }
  }

  async function saveProfile(event) {
    event.preventDefault();
    const button = document.getElementById("profileSubmit");
    const payload = {
      full_name: document.getElementById("profileName").value.trim() || null,
      company_name: document.getElementById("profileCompany").value.trim() || null,
      phone: document.getElementById("profilePhone").value.trim() || null,
      currency: document.getElementById("profileCurrency").value,
    };

    UI.setButtonLoading(button, true);
    try {
      const saved = await API.put("/api/settings/profile", payload);
      UI.setCurrency(saved.currency);
      const nameEl = document.getElementById("sidebarName");
      const avatarEl = document.getElementById("sidebarAvatar");
      if (nameEl) nameEl.textContent = saved.full_name || "";
      if (avatarEl) avatarEl.textContent = UI.initials(saved.full_name);
      UI.toast("Profile saved.", "success");
    } catch (error) {
      UI.toast(error.message, "error");
    } finally {
      UI.setButtonLoading(button, false);
    }
  }

  async function savePassword(event) {
    event.preventDefault();
    const button = document.getElementById("passwordSubmit");
    const newPassword = document.getElementById("newPassword").value;
    const confirmPassword = document.getElementById("confirmPassword").value;

    if (newPassword.length < 6) return UI.toast("Password must be at least 6 characters.", "error");
    if (newPassword !== confirmPassword) return UI.toast("Passwords do not match.", "error");

    UI.setButtonLoading(button, true);
    try {
      const result = await API.put("/api/settings/password", { new_password: newPassword });
      UI.toast(result.message, "success");
      document.getElementById("passwordForm").reset();
    } catch (error) {
      UI.toast(error.message, "error");
    } finally {
      UI.setButtonLoading(button, false);
    }
  }
})();
