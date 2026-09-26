// Small vanilla JS: run button + status polling (dashboard),
// expand / discard / restore (offers page).

let toastTimer;

// Short message at the bottom of the screen, hides itself after a few seconds.
function setStatusBar(text) {
  const el = document.getElementById("status-text");
  if (!el) return;
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 4000);
}

// ---------- Dashboard ----------

function renderJob(job) {
  const msg = document.getElementById("job-message");
  const fill = document.getElementById("progress-fill");
  const button = document.getElementById("run-button");
  if (!msg) return;

  msg.textContent = job.message;
  msg.className = "job-message job-" + job.state;
  button.disabled = job.state === "running";

  const indeterminate = job.state === "running" && job.percent == null;
  fill.classList.toggle("indeterminate", indeterminate);
  fill.style.width = indeterminate ? "" : (job.state === "running" || job.state === "done" ? (job.percent || 0) : 0) + "%";
}

const APP_DOWN = "The app is not responding. Restart it with the desktop shortcut.";

// fetch + JSON, with one readable error for every kind of failure.
async function callApi(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch {
    throw new Error(APP_DOWN);
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(res.status === 403 ? "Request refused." : "The app had an internal error, see data/app.log.");
  }
  return { status: res.status, data };
}

function showJobError(message) {
  renderJob({ state: "error", message, percent: null });
}

let pollFailures = 0;

async function pollJob() {
  try {
    const { data: job } = await callApi("/api/status");
    pollFailures = 0;
    renderJob(job);
    if (job.state === "running") {
      setTimeout(pollJob, 1000);
    } else if (job.state === "done") {
      setTimeout(() => location.reload(), 1500);
    }
  } catch (e) {
    // a few misses can happen while the app is busy: give up after ~10 s
    if (++pollFailures < 10) setTimeout(pollJob, 1000);
    else showJobError(e.message);
  }
}

function initDashboard() {
  const button = document.getElementById("run-button");
  if (!button) return;

  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const { data } = await callApi("/api/run", { method: "POST" });
      renderJob(data);
      pollJob();
    } catch (e) {
      showJobError(e.message);
    }
  });

  if (document.getElementById("job-message").dataset.state === "running") pollJob();
}

// ---------- Offers ----------

function toggleOffer(tbody) {
  const detail = tbody.querySelector(".detail");
  detail.hidden = !detail.hidden;
  tbody.classList.toggle("open", !detail.hidden);
  if (!detail.hidden) loadDescription(detail.querySelector(".description"));
}

// Descriptions are fetched the first time an offer is opened (keeps the lists light).
async function loadDescription(box) {
  if (!box || box.dataset.loaded) return;
  box.dataset.loaded = "loading";
  try {
    const { data } = await callApi(box.dataset.src);
    box.innerHTML = data.html;
    box.dataset.loaded = "yes";
  } catch (e) {
    box.innerHTML = "";
    const p = document.createElement("p");
    p.className = "error";
    p.textContent = `Could not load the description. ${e.message}`;
    box.appendChild(p);
    delete box.dataset.loaded; // try again next time the offer is opened
  }
}

function removeOffer(tbody) {
  const group = tbody.closest(".offer-group");
  tbody.remove();
  const left = group.querySelectorAll("tbody.offer").length;
  group.querySelector(".group-count").textContent = left;
  if (left === 0) group.remove();
  const total = document.getElementById("total-count");
  total.textContent = Math.max(0, Number(total.textContent) - 1);
}

async function changeStatus(tbody, action) {
  const id = tbody.dataset.id;
  let data;
  try {
    ({ data } = await callApi(`/api/offers/${encodeURIComponent(id)}/${action}`, { method: "POST" }));
  } catch (e) {
    setStatusBar(`Could not ${action} this offer. ${e.message}`);
    return;
  }
  if (!data.ok) {
    setStatusBar(`Could not ${action} this offer: it no longer exists. Reload the page.`);
    return;
  }
  const title = tbody.querySelector(".offer-title").textContent.trim();
  removeOffer(tbody);
  const messages = {
    discard: `Discarded: ${title}. You can restore it from the Discarded page.`,
    restore: `Restored: ${title}.`,
    keep: `Kept: ${title}. It is now in your Offers.`,
  };
  setStatusBar(messages[action]);
}

function initOffers() {
  document.querySelectorAll("tbody.offer").forEach((tbody) => {
    const summary = tbody.querySelector(".summary");
    summary.addEventListener("click", (e) => {
      const button = e.target.closest("button.action");
      if (button) {
        e.stopPropagation();
        button.disabled = true;
        changeStatus(tbody, button.dataset.action).finally(() => (button.disabled = false));
        return;
      }
      if (e.target.closest("a")) return;
      toggleOffer(tbody);
    });
    summary.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && e.target === summary) {
        e.preventDefault();
        toggleOffer(tbody);
      }
    });
  });
}

// ---------- Quit ----------

function initQuit() {
  const button = document.getElementById("quit-button");
  if (!button) return;
  button.addEventListener("click", async () => {
    if (!confirm("Stop SAM.gov Tracker?")) return;
    try {
      await fetch("/api/quit", { method: "POST" });
    } catch {
      // the server may already be gone
    }
    document.querySelector("main").innerHTML =
      '<div class="card stopped"><h2>App stopped</h2><p>You can close this window. ' +
      "Use the desktop shortcut to start it again.</p></div>";
    window.close(); // works in the app window, ignored in a normal browser tab
  });
}

// ---------- Settings ----------

function initSettings() {
  const rows = document.getElementById("keyword-rows");
  if (!rows) return;
  const template = document.getElementById("keyword-template");
  const filter = document.getElementById("keyword-filter");
  const count = document.getElementById("keyword-count");
  let nextIndex = rows.children.length; // new rows get their own index (links the "title only" box)

  const updateCount = () => (count.textContent = rows.querySelectorAll(".keyword-row").length);

  document.getElementById("add-keyword").addEventListener("click", () => {
    const row = template.content.firstElementChild.cloneNode(true);
    row.querySelector("input[name=kw_index]").value = nextIndex;
    row.querySelector("input[name=kw_title_only]").value = nextIndex;
    nextIndex += 1;
    filter.value = "";
    rows.querySelectorAll(".keyword-row").forEach((r) => (r.hidden = false));
    rows.prepend(row);
    rows.scrollTop = 0;
    row.querySelector("input[name=kw_text]").focus();
    updateCount();
  });

  rows.addEventListener("click", (e) => {
    const button = e.target.closest(".remove-keyword");
    if (!button) return;
    button.closest(".keyword-row").remove();
    updateCount();
  });

  filter.addEventListener("input", () => {
    const q = filter.value.trim().toLowerCase();
    rows.querySelectorAll(".keyword-row").forEach((r) => {
      r.hidden = q !== "" && !r.querySelector("input[name=kw_text]").value.toLowerCase().includes(q);
    });
  });
}

initDashboard();
initOffers();
initQuit();
initSettings();
