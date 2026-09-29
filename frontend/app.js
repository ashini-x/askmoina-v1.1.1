export default function(component) {
  const root = component.parentElement;
  const get = (selector) => root.querySelector(selector);
  const all = (selector) => Array.from(root.querySelectorAll(selector));
  const sendEvent = (payload) => component.setTriggerValue("event", payload);

  if (!root.__askmoinaCtx) {
    root.__askmoinaCtx = {
      component,
      data: {},
      state: {
        mode: "auto",
        expandedPrompts: new Set(),
        workflowPhase: "idle",
        workflowJobId: null,
        thinking: false,
        revealPendingJobId: null,
        revealTimer: null,
        toastTimer: null,
        scrollTimer: null,
      },
    };
  }

  const ctx = root.__askmoinaCtx;
  ctx.component = component;
  ctx.data = component.data || {};
  const state = ctx.state;

  function iconChevron() {
    return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';
  }

  function iconCopy() {
    return '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="7" height="8" rx="1"/><path d="M9 5V3.5A1.5 1.5 0 0 0 7.5 2H4A1.5 1.5 0 0 0 2.5 3.5v7A1.5 1.5 0 0 0 4 12h1"/></svg>';
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    }[char]));
  }

  function formatTime(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const now = new Date();
    return date.toDateString() === now.toDateString()
      ? date.toLocaleTimeString([], {hour:"numeric", minute:"2-digit"})
      : date.toLocaleDateString([], {month:"short", day:"numeric"});
  }

  function showToast(message) {
    const toast = get("[data-toast]");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.remove("show"), 1700);
  }

  function animateStatusLabel(label) {
    const node = get("[data-thinking-phrase]");
    if (!node || !label) return;
    node.animate([
      {opacity: 1, transform: "translateY(0)", filter: "blur(0px)"},
      {opacity: 0, transform: "translateY(-4px)", filter: "blur(1.5px)"},
    ], {duration: 170, easing: "ease-out", fill: "forwards"}).onfinish = () => {
      node.textContent = label;
      node.animate([
        {opacity: 0, transform: "translateY(4px)", filter: "blur(1.5px)"},
        {opacity: 1, transform: "translateY(0)", filter: "blur(0px)"},
      ], {duration: 300, easing: "cubic-bezier(.22,1,.36,1)", fill: "forwards"});
    };
  }

  function setWorkflowVisual(workflow) {
    const active = Boolean(workflow?.active);
    const phase = workflow?.phase || "idle";
    const label = workflow?.label || "";
    const changed = phase !== state.workflowPhase || workflow?.job_id !== state.workflowJobId;

    state.workflowPhase = phase;
    state.workflowJobId = workflow?.job_id || null;

    if (active) state.thinking = true;
    if (workflow?.status === "error" || workflow?.status === "idle") state.thinking = false;

    return {changed, active, label};
  }

  function animatePhaseIn() {
    const row = get("[data-thinking-row]");
    if (!row) return;
    row.animate([
      {opacity: 0, transform: "translateY(4px)", filter: "blur(1.5px)"},
      {opacity: 1, transform: "translateY(0)", filter: "blur(0px)"},
    ], {duration: 320, easing: "cubic-bezier(.22,1,.36,1)", fill: "forwards"});
  }

  function resizeInput() {
    const input = get("[data-input]");
    if (!input) return;
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 170) + "px";
    get("[data-action='send']")?.classList.toggle("ready", input.value.trim().length > 0);
  }

  function renderModes() {
    const busy = Boolean(ctx.data?.workflow?.active);
    all(".mode").forEach((node) => {
      const active = node.dataset.mode === state.mode;
      node.classList.toggle("active", active);
      node.classList.toggle("disabled", busy);
      node.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  function renderHistory(items) {
    const list = get("[data-history-list]");
    if (!list) return;
    if (!items?.length) {
      list.innerHTML = '<div class="history-empty">No saved conversations yet.</div>';
      return;
    }
    list.innerHTML = items.map((item) => `
      <div class="history-item ${item.active ? "active" : ""}" data-history-id="${esc(item.id)}">
        <div class="history-title">${esc(item.title)}</div>
        <div class="history-time">${esc(formatTime(item.updated_at))}</div>
        <div class="history-actions">
          <button data-history-action="rename" data-id="${esc(item.id)}" aria-label="Rename">✎</button>
          <button data-history-action="delete" data-id="${esc(item.id)}" aria-label="Delete">×</button>
        </div>
      </div>`).join("");
  }

  function renderConversation(data) {
    const conversation = get("[data-conversation]");
    const empty = get("[data-empty]");
    if (!conversation || !empty) return;
    const messages = data.messages || [];
    const workflow = data.workflow || {};
    const active = Boolean(workflow.active);
    const completePending = workflow.status === "complete" && state.revealPendingJobId === workflow.job_id;

    empty.style.display = messages.length ? "none" : "flex";
    conversation.innerHTML = "";
    if (!messages.length) return;

    const lastUserIndex = messages.reduce((last, message, index) => (message.role === "user" ? index : last), -1);

    for (let i = 0; i < messages.length; i += 1) {
      const user = messages[i];
      if (user.role !== "user") continue;
      const assistant = messages[i + 1]?.role === "assistant" ? messages[i + 1] : null;
      const isLastUser = i === lastUserIndex;
      const key = `${i}:${user.content.length}`;
      const isLong = user.content.length > 220 || user.content.split(/\s+/).length > 42;
      const expanded = state.expandedPrompts.has(key);
      const block = document.createElement("div");
      block.className = "entry answered";
      block.innerHTML = `
        <div class="rail thought" aria-hidden="true"></div>
        <div class="entry-content">
          <div class="thought-wrap ${isLong && !expanded ? "collapsed" : ""}">
            <div class="thought-text ${isLong ? "long" : ""} ${isLong && !expanded ? "collapsed" : ""}" data-thought-text="${esc(key)}"></div>
            ${isLong ? `<button class="thought-toggle ${expanded ? "expanded" : ""}" data-thought-toggle="${esc(key)}" aria-label="${expanded ? "Collapse thought" : "Expand thought"}">${iconChevron()}</button>` : ""}
          </div>
          ${isLong ? `<div class="thought-tools"><button class="thought-copy" data-copy-thought="${esc(key)}" aria-label="Copy thought" title="Copy thought">${iconCopy()}</button></div>` : ""}
        </div>`;
      block.querySelector("[data-thought-text]").textContent = user.content;

      const showThinking = isLastUser && (active || completePending);
      const hideResponse = completePending;

      if (assistant || showThinking) {
        const answer = document.createElement("div");
        answer.className = "entry answer-entry";
        answer.innerHTML = `
          <div class="rail answer" aria-hidden="true"></div>
          <div class="entry-content">
            <div class="thinking ${showThinking ? "visible" : ""}" data-thinking-row><span class="signal"></span><span data-thinking-phrase>${esc(workflow.label || "Initializing AskMoina Engine")}</span></div>
            ${assistant ? `<div class="response ${hideResponse ? "response-pending" : "visible"}">
              <div class="response-body"></div>
              <div class="response-actions">
                <button class="response-action" data-copy-response>Copy</button>
                <button class="response-action" data-regenerate>Regenerate</button>
                <button class="response-action" data-more>More</button>
              </div>
            </div>` : ""}
          </div>`;
        if (assistant) {
          const body = answer.querySelector(".response-body");
          body.innerHTML = assistant.html || `<p>${esc(assistant.content)}</p>`;
        }
        block.appendChild(answer);
      }
      conversation.appendChild(block);
    }
  }

  function startRevealTimer(jobId) {
    clearTimeout(state.revealTimer);
    state.revealPendingJobId = jobId;
    state.thinking = true;
    state.workflowPhase = "complete";
    state.workflowJobId = jobId;
    renderConversation(ctx.data);
    state.revealTimer = setTimeout(() => {
      state.revealPendingJobId = null;
      state.thinking = false;
      renderConversation(ctx.data);
      sendEvent({type:"ui.response_revealed", job_id:jobId});
    }, 720);
  }

  function sync(data) {
    ctx.data = data || {};
    state.mode = data.mode || state.mode;
    const workflow = data.workflow || {};
    const transition = setWorkflowVisual(workflow);

    if (workflow.status === "complete" && workflow.job_id) {
      if (state.revealPendingJobId !== workflow.job_id) {
        renderModes();
        renderHistory(data.history || []);
        startRevealTimer(workflow.job_id);
        animatePhaseIn();
        if (data.error && !workflow.active) showToast(data.error);
        return;
      }
    } else if (workflow.status === "error") {
      clearTimeout(state.revealTimer);
      state.revealPendingJobId = null;
      state.thinking = false;
    } else if (workflow.status === "running") {
      state.thinking = true;
    } else if (workflow.status === "idle") {
      state.thinking = false;
      state.revealPendingJobId = null;
      clearTimeout(state.revealTimer);
    }

    renderModes();
    renderHistory(data.history || []);
    renderConversation(data);
    resizeInput();

    if (transition.changed && transition.active) animatePhaseIn();
    if (data.error && !workflow.active) showToast(data.error);
  }

  function openOverlay(selector) {
    const overlay = get(selector);
    overlay?.classList.add("open");
    overlay?.setAttribute("aria-hidden", "false");
  }

  function closeOverlay(selector) {
    const overlay = get(selector);
    overlay?.classList.remove("open");
    overlay?.setAttribute("aria-hidden", "true");
  }

  if (!root.__askmoinaBound) {
    root.__askmoinaBound = true;

    all(".mode").forEach((node) => node.addEventListener("click", () => {
      if (ctx.data?.workflow?.active) return;
      state.mode = node.dataset.mode;
      renderModes();
      sendEvent({type:"mode.select", mode:state.mode});
    }));

    all("[data-suggestion]").forEach((node) => node.addEventListener("click", () => {
      if (ctx.data?.workflow?.active) return;
      const input = get("[data-input]");
      input.value = node.dataset.suggestion;
      resizeInput();
      input.focus();
    }));

    const input = get("[data-input]");
    input?.addEventListener("input", resizeInput);
    input?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        submitPrompt();
      }
    });

    function submitPrompt() {
      if (ctx.data?.workflow?.active) return;
      const value = input?.value.trim();
      if (!value) return;
      showToast("AskMoina is processing");
      sendEvent({type:"chat.submit", prompt:value, mode:state.mode});
      input.value = "";
      resizeInput();
    }

    get("[data-action='send']")?.addEventListener("click", submitPrompt);
    get("[data-action='plus']")?.addEventListener("click", () => showToast("Attachment actions can be enabled here"));
    get("[data-action='attach']")?.addEventListener("click", () => showToast("Attachments are reserved for the next integration step"));
    get("[data-action='history']")?.addEventListener("click", () => openOverlay("[data-history-overlay]"));
    get("[data-action='history-close']")?.addEventListener("click", () => closeOverlay("[data-history-overlay]"));
    get("[data-action='settings']")?.addEventListener("click", () => showToast("Live search and sandbox verification are always on"));
    get("[data-action='new']")?.addEventListener("click", () => { closeOverlay("[data-history-overlay]"); sendEvent({type:"conversation.new"}); });

    root.addEventListener("click", async (event) => {
      const toggle = event.target.closest("[data-thought-toggle]");
      if (toggle) {
        const key = toggle.dataset.thoughtToggle;
        if (state.expandedPrompts.has(key)) state.expandedPrompts.delete(key); else state.expandedPrompts.add(key);
        renderConversation(ctx.data);
        return;
      }

      const copyThought = event.target.closest("[data-copy-thought]");
      if (copyThought) {
        const key = copyThought.dataset.copyThought;
        const textNode = root.querySelector(`[data-thought-text="${CSS.escape(key)}"]`);
        if (textNode) {
          await navigator.clipboard?.writeText(textNode.textContent || "");
          showToast("Thought copied");
        }
        return;
      }

      const copyResponse = event.target.closest("[data-copy-response]");
      if (copyResponse) {
        const answer = copyResponse.closest(".response");
        const text = answer?.querySelector(".response-body")?.innerText?.trim() || "";
        await navigator.clipboard?.writeText(text);
        showToast("Response copied");
        return;
      }

      if (event.target.closest("[data-regenerate]")) {
        if (ctx.data?.workflow?.active) return;
        showToast("AskMoina is processing");
        sendEvent({type:"chat.regenerate"});
        return;
      }

      if (event.target.closest("[data-more]")) {
        showToast("More actions can be enabled here");
        return;
      }

      const historyButton = event.target.closest("[data-history-action]");
      if (historyButton) {
        const id = historyButton.dataset.id;
        if (historyButton.dataset.historyAction === "rename") {
          const title = window.prompt("Rename conversation", "");
          if (title?.trim()) sendEvent({type:"conversation.rename", conversation_id:id, title:title.trim()});
        } else {
          sendEvent({type:"conversation.delete", conversation_id:id});
        }
        return;
      }

      const historyItem = event.target.closest("[data-history-id]");
      if (historyItem) {
        closeOverlay("[data-history-overlay]");
        sendEvent({type:"conversation.select", conversation_id:historyItem.dataset.historyId});
      }
    });

    get("[data-history-overlay]")?.addEventListener("click", (event) => {
      if (event.target === get("[data-history-overlay]")) closeOverlay("[data-history-overlay]");
    });

    const scroll = get("[data-scroll]");
    scroll?.addEventListener("scroll", () => {
      get("[data-modes]")?.classList.add("scrolling");
      clearTimeout(state.scrollTimer);
      state.scrollTimer = setTimeout(() => get("[data-modes]")?.classList.remove("scrolling"), 180);
    }, {passive:true});

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeOverlay("[data-history-overlay]");
    });
  }

  sync(ctx.data);

  return () => {
    clearTimeout(state.revealTimer);
    clearTimeout(state.scrollTimer);
  };
}
