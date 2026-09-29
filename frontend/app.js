export default function(component) {
  const root = component.parentElement;
  const qs = (selector, scope = root) => scope.querySelector(selector);
  const qsa = (selector, scope = root) => Array.from(scope.querySelectorAll(selector));
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
        workflowStatus: "idle",
        revealPendingJobId: null,
        revealTimer: null,
        toastTimer: null,
        scrollTimer: null,
        lastMessagesKey: null,
        geometryFrame: 0,
      },
    };
  }

  const ctx = root.__askmoinaCtx;
  ctx.component = component;
  ctx.data = component.data || {};
  const state = ctx.state;

  const iconChevron = () => '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>';
  const iconCopy = () => '<svg viewBox="0 0 24 24"><rect height="11" rx="2" width="11" x="8" y="8"></rect><path d="M5 16H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1"></path></svg>';

  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;"
  }[char]));

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
    const toast = qs("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.remove("show"), 1600);
  }

  function animateTextSwap(text) {
    if (!text) return;
    text.animate([
      {opacity:1, transform:"translateY(0)", filter:"blur(0)"},
      {opacity:0, transform:"translateY(-5px)", filter:"blur(2px)"}
    ], {duration:260, easing:"ease", fill:"forwards"}).onfinish = () => {
      text.animate([
        {opacity:0, transform:"translateY(5px)", filter:"blur(2px)"},
        {opacity:1, transform:"translateY(0)", filter:"blur(0)"}
      ], {duration:420, easing:"cubic-bezier(.22,1,.36,1)", fill:"forwards"});
    };
  }

  function renderHistory(items) {
    const panel = qs("#historyBackdrop");
    if (!panel) return;
    const existingSections = qsa(".history-section", panel);
    existingSections.forEach(section => section.remove());
    const list = items?.length ? items : [
      {id:"mock-1", title:"Designing a better city", updated_at:"", active:true},
      {id:"mock-2", title:"Product concept", updated_at:"", active:false},
      {id:"mock-3", title:"Interface ideas", updated_at:"", active:false},
    ];
    const section = document.createElement("div");
    section.className = "history-section";
    section.innerHTML = `<div class="history-section-label">Conversations</div>` + list.map(item => `
      <button class="entry ${item.active ? "selected" : ""}" data-history="${esc(item.id)}">
        <span class="entry-text">${esc(item.title)}</span>
        <span class="entry-time">${esc(formatTime(item.updated_at))}</span>
      </button>
    `).join("");
    panel.querySelector(".history-panel")?.appendChild(section);
  }

  function renderConversation(data) {
    const empty = qs("#emptyState");
    const conversation = qs("#conversation");
    if (!empty || !conversation) return;

    const messages = data.messages || [];
    const workflow = data.workflow || {};
    const lastUserIndex = messages.reduce((last, message, index) => message.role === "user" ? index : last, -1);
    const pending = workflow.status === "complete" && state.revealPendingJobId === workflow.job_id;

    empty.style.display = messages.length ? "none" : "flex";
    conversation.classList.toggle("active", messages.length > 0);
    conversation.innerHTML = "";
    if (!messages.length) return;

    for (let i = 0; i < messages.length; i += 1) {
      const message = messages[i];
      if (message.role !== "user") continue;

      const assistant = messages[i + 1]?.role === "assistant" ? messages[i + 1] : null;
      const isLastUser = i === lastUserIndex;
      const key = `${i}:${message.content.length}`;
      const isLong = message.content.length > 220 || message.content.split(/\s+/).length > 42;
      const expanded = state.expandedPrompts.has(key);
      const showThinking = isLastUser && (workflow.active || pending);

      const pair = document.createElement("div");
      pair.className = "conversation-pair";
      pair.innerHTML = `
        <div class="thought-block">
          <div class="thought-rail" aria-hidden="true"></div>
          <div class="thought-content">
            <div class="thought-preview ${isLong && !expanded ? "long-collapsed" : ""}">
              <p class="thought-text ${isLong ? "long" : ""} ${isLong && !expanded ? "collapsed" : ""}" data-thought-text="${esc(key)}"></p>
              ${isLong ? `<button class="thought-toggle ${expanded ? "expanded" : ""}" data-thought-toggle="${esc(key)}" type="button" aria-label="${expanded ? "Collapse thought" : "Expand thought"}" title="${expanded ? "Collapse thought" : "Expand thought"}">${iconChevron()}</button>` : ""}
            </div>
            ${isLong ? `<div class="thought-tools"><button class="thought-tool" data-copy-thought="${esc(key)}" type="button" aria-label="Copy thought" title="Copy thought"><span class="tool-icon" aria-hidden="true">${iconCopy()}</span><span class="copy-label">Copy</span></button></div>` : ""}
          </div>
        </div>

        ${(assistant || showThinking) ? `<div class="response-wrap">
          <div class="answer-rail" aria-hidden="true"></div>
          <div class="response-content">
            <div class="thinking ${showThinking ? "visible" : ""}" data-thinking-row>
              <span class="signal" aria-hidden="true"></span>
              <span class="thinking-phrase" data-thinking-phrase>${esc(workflow.label || "Initializing AskMoina Engine")}</span>
            </div>
            ${assistant ? `<article class="response ${pending ? "" : "visible"}">
              <p class="lead"></p>
              <div class="response-body"></div>
              <div class="actions">
                <button class="response-action" data-copy-response type="button">Copy</button>
                <button class="response-action" data-regenerate type="button">Regenerate</button>
                <button class="response-action" data-more type="button">More</button>
              </div>
            </article>` : ""}
          </div>
        </div>` : ""}
      `;

      pair.querySelector("[data-thought-text]").textContent = message.content;

      if (assistant) {
        const article = pair.querySelector(".response");
        const body = article?.querySelector(".response-body");
        if (body) body.innerHTML = assistant.html || `<p>${esc(assistant.content)}</p>`;
      }

      conversation.appendChild(pair);
    }

  }

  function renderModes() {
    const busy = Boolean(ctx.data?.workflow?.active);
    qsa(".mode").forEach(mode => {
      const active = mode.dataset.mode === state.mode;
      mode.classList.toggle("active", active);
      mode.classList.toggle("disabled", busy);
      mode.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  function messagesKey(messages) {
    return JSON.stringify((messages || []).map(message => [message.role, message.content]));
  }

  function updateThinkingLabel(label) {
    const phrase = qs("[data-thinking-phrase]");
    if (!phrase || !label) return;
    if (phrase.textContent === label) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (reduceMotion) {
      phrase.textContent = label;
      phrase.style.opacity = "1";
      phrase.style.filter = "none";
      phrase.style.transform = "none";
      return;
    }
    phrase.animate([
      {opacity:1, transform:"translateY(0)", filter:"blur(0)"},
      {opacity:0, transform:"translateY(-4px)", filter:"blur(1.5px)"}
    ], {duration:180, easing:"ease", fill:"forwards"}).onfinish = () => {
      phrase.textContent = label;
      phrase.animate([
        {opacity:0, transform:"translateY(4px)", filter:"blur(1.5px)"},
        {opacity:1, transform:"translateY(0)", filter:"blur(0)"}
      ], {duration:280, easing:"cubic-bezier(.22,1,.36,1)", fill:"forwards"});
    };
  }

  function updateComposerGeometry() {
    const app = qs(".app");
    const wrap = qs(".composer-wrap");
    const modes = qs(".mode-bar");
    if (!app || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    const modeRect = modes?.getBoundingClientRect();
    const gap = window.matchMedia?.("(max-width: 720px)")?.matches ? 24 : 30;
    const viewportGap = Math.max(0, app.clientHeight - rect.top);
    app.style.setProperty("--composer-stack-height", `${Math.ceil(viewportGap)}px`);
    app.style.setProperty("--composer-clearance", `${Math.ceil(viewportGap + gap)}px`);
    if (modeRect) app.style.setProperty("--mode-top", `${Math.ceil(modeRect.top)}px`);
  }

  function scrollLatestIntoPosition() {
    const app = qs(".app");
    const actions = qsa(".actions", qs("#conversation") || root).at(-1);
    const modes = qs(".mode-bar");
    if (!app || !actions || !modes) return;
    const modeTop = modes.getBoundingClientRect().top;
    const actionBottom = actions.getBoundingClientRect().bottom;
    const mobile = window.matchMedia?.("(max-width: 720px)")?.matches;
    const clearance = mobile ? 82 : 112; // ~30mm on desktop, comfortable mobile equivalent
    const delta = actionBottom - (modeTop - clearance);
    const maxScroll = Math.max(0, app.scrollHeight - app.clientHeight);
    const target = Math.min(maxScroll, Math.max(0, app.scrollTop + delta));
    if (Math.abs(delta) > 2) app.scrollTo({top: target, behavior:"smooth"});
  }

  function sync(data) {
    ctx.data = data || {};
    state.mode = data.mode || state.mode;
    const workflow = data.workflow || {};
    const prevPhase = state.workflowPhase;
    const prevJob = state.workflowJobId;
    const previousStatus = state.workflowStatus || "idle";
    const currentMessagesKey = messagesKey(data.messages || []);
    const messagesChanged = currentMessagesKey !== state.lastMessagesKey;

    state.workflowPhase = workflow.phase || "idle";
    state.workflowJobId = workflow.job_id || null;
    state.workflowStatus = workflow.status || "idle";
    state.lastMessagesKey = currentMessagesKey;

    renderModes();
    renderHistory(data.history || []);

    if (workflow.status === "complete" && workflow.job_id) {
      if (state.revealPendingJobId !== workflow.job_id) {
        state.revealPendingJobId = workflow.job_id;
        renderConversation(data);
        const phrase = qs(".thinking-phrase:last-child");
        if (phrase) {
          phrase.animate([
            {opacity:0,transform:"translateY(4px)",filter:"blur(2px)"},
            {opacity:1,transform:"translateY(0)",filter:"blur(0)"}
          ], {duration:300,easing:"cubic-bezier(.22,1,.36,1)",fill:"forwards"});
        }
        clearTimeout(state.revealTimer);
        state.revealTimer = setTimeout(() => {
          state.revealPendingJobId = null;
          renderConversation(ctx.data);
          requestAnimationFrame(() => {
            updateComposerGeometry();
            updateComposerGeometry();
            scrollLatestIntoPosition();
            ctx.updateScrollLatest?.();
          });
          sendEvent({type:"ui.response_revealed", job_id:workflow.job_id});
        }, 640);
        return;
      }
    } else if (workflow.status !== "complete") {
      clearTimeout(state.revealTimer);
      state.revealPendingJobId = null;
    }

    if (messagesChanged) {
      renderConversation(data);
    } else if (workflow.active && (workflow.phase !== prevPhase || workflow.job_id !== prevJob)) {
      updateThinkingLabel(workflow.label);
    }

    if (workflow.status === "complete" && previousStatus !== "complete" && !state.revealPendingJobId) {
      renderConversation(data);
    }

    updateComposerGeometry();
    ctx.updateScrollLatest?.();

    if (data.error && workflow.status === "error") showToast(data.error);
  }

  function openHistory() {
    const backdrop = qs("#historyBackdrop");
    backdrop?.classList.add("open");
    backdrop?.setAttribute("aria-hidden", "false");
  }

  function closeHistory() {
    const backdrop = qs("#historyBackdrop");
    backdrop?.classList.remove("open");
    backdrop?.setAttribute("aria-hidden", "true");
  }

  function resizeInput() {
    const input = qs("#input");
    if (!input) return;
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 220) + "px";
    qs("#sendBtn")?.classList.toggle("disabled", !input.value.trim());
    requestAnimationFrame(updateComposerGeometry);
  }

  function submitPrompt() {
    const input = qs("#input");
    if (!input || ctx.data?.workflow?.active) return;
    const value = input.value.trim();
    if (!value) return;
    sendEvent({type:"chat.submit", prompt:value, mode:state.mode});
    input.value = "";
    resizeInput();
    showToast("AskMoina is processing");
  }

  if (!root.__askmoinaBound) {
    root.__askmoinaBound = true;

    qsa(".mode").forEach(mode => mode.addEventListener("click", () => {
      if (ctx.data?.workflow?.active) return;
      state.mode = mode.dataset.mode;
      renderModes();
      sendEvent({type:"mode.select", mode:state.mode});
      showToast(`${mode.querySelector(".mode-name")?.textContent || state.mode} mode`);
    }));

    qsa(".suggestion").forEach(button => button.addEventListener("click", () => {
      const input = qs("#input");
      if (!input) return;
      input.value = button.dataset.suggestion || "";
      resizeInput();
      input.focus();
    }));

    qs("#input")?.addEventListener("input", resizeInput);
    qs("#input")?.addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        submitPrompt();
      }
    });

    qs("#sendBtn")?.addEventListener("click", submitPrompt);
    qs("#attachBtn")?.addEventListener("click", () => showToast("Attachment actions are reserved for a future release"));
    qs("#settingsBtn")?.addEventListener("click", () => showToast("Live Search and Sandbox are always on"));
    qs("#historyBtn")?.addEventListener("click", openHistory);
    qs("#closeHistory")?.addEventListener("click", closeHistory);
    qs("#newBtn")?.addEventListener("click", () => { closeHistory(); sendEvent({type:"conversation.new"}); });

    root.addEventListener("click", async event => {
      const toggle = event.target.closest("[data-thought-toggle]");
      if (toggle) {
        const key = toggle.dataset.thoughtToggle;
        state.expandedPrompts.has(key) ? state.expandedPrompts.delete(key) : state.expandedPrompts.add(key);
        renderConversation(ctx.data);
        return;
      }

      const copyThought = event.target.closest("[data-copy-thought]");
      if (copyThought) {
        const key = copyThought.dataset.copyThought;
        const node = root.querySelector(`[data-thought-text="${CSS.escape(key)}"]`);
        if (node) {
          await navigator.clipboard?.writeText(node.textContent || "");
          showToast("Thought copied");
        }
        return;
      }

      const copyResponse = event.target.closest("[data-copy-response]");
      if (copyResponse) {
        const body = copyResponse.closest(".response")?.querySelector(".response-body");
        await navigator.clipboard?.writeText(body?.innerText?.trim() || "");
        showToast("Response copied");
        return;
      }

      if (event.target.closest("[data-regenerate]")) {
        if (ctx.data?.workflow?.active) return;
        sendEvent({type:"chat.regenerate"});
        showToast("AskMoina is processing");
        return;
      }

      if (event.target.closest("[data-more]")) {
        showToast("More actions can be enabled here");
        return;
      }

      const historyEntry = event.target.closest("[data-history]");
      if (historyEntry) {
        const id = historyEntry.dataset.history;
        if (id?.startsWith("mock-")) {
          closeHistory();
          return;
        }
        closeHistory();
        sendEvent({type:"conversation.select", conversation_id:id});
      }
    });

    qs("#historyBackdrop")?.addEventListener("click", event => {
      if (event.target === qs("#historyBackdrop")) closeHistory();
    });

    const appScroll = qs(".app");
    const scrollLatest = qs("#scrollLatest");
    const updateScrollLatest = () => {
      if (!appScroll || !scrollLatest) return;
      const messages = (ctx.data?.messages || []).length;
      const distance = appScroll.scrollHeight - appScroll.scrollTop - appScroll.clientHeight;
      scrollLatest.classList.toggle("visible", messages > 1 && distance > 150);
    };
    appScroll?.addEventListener("scroll", updateScrollLatest, {passive:true});
    scrollLatest?.addEventListener("click", () => {
      if (!appScroll) return;
      appScroll.scrollTo({top: appScroll.scrollHeight, behavior:"smooth"});
      window.setTimeout(() => scrollLatestIntoPosition(), 420);
    });
    window.addEventListener("resize", updateComposerGeometry, {passive:true});
    ctx.updateScrollLatest = updateScrollLatest;
    ctx.scrollLatestIntoPosition = scrollLatestIntoPosition;
    updateComposerGeometry();

    document.addEventListener("keydown", event => {
      if (event.key === "Escape") closeHistory();
    });
  }

  sync(ctx.data);

  return () => {
    clearTimeout(state.revealTimer);
    clearTimeout(state.scrollTimer);
  };
}
