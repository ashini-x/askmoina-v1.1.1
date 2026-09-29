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
        completionTimer: null,
        completionJobId: null,
        toastTimer: null,
        scrollTimer: null,
        lastMessagesKey: null,
        geometryFrame: 0,
        thinkingTimer: null,
        thinkingJobId: null,
        thinkingTargetIndex: 0,
        thinkingIndex: 0,
        thinkingStartedAt: 0,
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
    const isRevealPending = Boolean(
      workflow.status === "complete" && state.revealPendingJobId && state.revealPendingJobId === workflow.job_id
    );

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
      const showThinking = isLastUser && (
        (workflow.active && workflow.status !== "complete") || isRevealPending
      );

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
              <span class="thinking-phrase" data-thinking-phrase>${esc(THINKING_PHRASES[state.thinkingIndex] || "Thinking through the idea")}</span>
            </div>
            ${assistant ? `<article class="response ${isRevealPending ? "" : "visible"}">
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

    if (isRevealPending) {
      qsa(".thinking-phrase", conversation).at(-1)?.scrollIntoView({block:"nearest"});
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

  const THINKING_PHRASES = [
    "Thinking through the idea",
    "Exploring a few directions",
    "Connecting the pieces",
    "Working through the details",
    "Shaping a response",
    "Almost there",
  ];

  const PHASE_TARGET_INDEX = {
    initializing: 0,
    searching: 1,
    synthesizing: 2,
    sandbox: 3,
    auditing: 5,
    complete: 5,
  };

  function animateThinkingPhrase(nextIndex) {
    const phrase = qs("[data-thinking-phrase]");
    if (!phrase) return;
    const next = THINKING_PHRASES[Math.max(0, Math.min(nextIndex, THINKING_PHRASES.length - 1))];
    if (phrase.textContent === next) return;

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (reduceMotion) {
      phrase.textContent = next;
      phrase.style.opacity = "1";
      phrase.style.filter = "none";
      phrase.style.transform = "none";
      return;
    }

    phrase.animate([
      {opacity: 1, transform: "translateY(0)", filter: "blur(0)"},
      {opacity: 0, transform: "translateY(-5px)", filter: "blur(2px)"},
    ], {duration: 320, easing: "ease", fill: "forwards"}).onfinish = () => {
      phrase.textContent = next;
      phrase.animate([
        {opacity: 0, transform: "translateY(6px)", filter: "blur(2px)"},
        {opacity: 1, transform: "translateY(0)", filter: "blur(0)"},
      ], {duration: 460, easing: "cubic-bezier(.22,1,.36,1)", fill: "forwards"});
    };
  }

  function stopThinkingSequence() {
    clearInterval(state.thinkingTimer);
    state.thinkingTimer = null;
  }

  function startThinkingSequence(jobId, phase) {
    if (!jobId) return;
    const target = PHASE_TARGET_INDEX[phase] ?? 0;

    if (state.thinkingJobId !== jobId) {
      stopThinkingSequence();
      state.thinkingJobId = jobId;
      state.thinkingTargetIndex = target;
      state.thinkingIndex = 0;
      state.thinkingStartedAt = performance.now();
      const phrase = qs("[data-thinking-phrase]");
      if (phrase) {
        phrase.textContent = THINKING_PHRASES[0];
        phrase.style.opacity = "1";
        phrase.style.filter = "blur(0)";
        phrase.style.transform = "translateY(0)";
      }

      state.thinkingTimer = window.setInterval(() => {
        const workflow = ctx.data?.workflow || {};
        if (!workflow.active && workflow.status !== "complete") return;

        const currentTarget = PHASE_TARGET_INDEX[workflow.phase] ?? state.thinkingTargetIndex;
        state.thinkingTargetIndex = Math.max(state.thinkingTargetIndex, currentTarget);

        if (state.thinkingIndex < state.thinkingTargetIndex) {
          state.thinkingIndex += 1;
          animateThinkingPhrase(state.thinkingIndex);
          return;
        }

        // Once the audit stage is reached, keep the last part of the original
        // sequence alive without faking new backend phases.
        if (state.thinkingTargetIndex >= 5 && workflow.status !== "complete") {
          state.thinkingIndex = state.thinkingIndex === 4 ? 5 : 4;
          animateThinkingPhrase(state.thinkingIndex);
        }
      }, 1180);
      return;
    }

    state.thinkingTargetIndex = Math.max(state.thinkingTargetIndex, target);
  }

  function resetThinkingSequence() {
    stopThinkingSequence();
    state.thinkingJobId = null;
    state.thinkingTargetIndex = 0;
    state.thinkingIndex = 0;
    state.thinkingStartedAt = 0;
  }

  function flashCompletion() {
    const conversation = qs("#conversation");
    if (!conversation) return;
    const previous = conversation.querySelector(".completion-flash");
    previous?.remove();

    const flash = document.createElement("div");
    flash.className = "completion-flash";
    flash.innerHTML = '<span class="completion-signal" aria-hidden="true"></span><span>Verification and Audit Complete</span>';
    conversation.appendChild(flash);

    requestAnimationFrame(() => flash.classList.add("visible"));
    clearTimeout(state.completionTimer);
    state.completionTimer = window.setTimeout(() => {
      flash.classList.remove("visible");
      flash.classList.add("fade");
      window.setTimeout(() => flash.remove(), 360);
    }, 160);
  }

  function updateComposerGeometry() {
    const app = qs(".app");
    const wrap = qs(".composer-wrap");
    if (!app || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    const gap = window.matchMedia?.("(max-width: 720px)")?.matches ? 26 : 34;
    const viewportGap = Math.max(0, app.clientHeight - rect.top);
    app.style.setProperty("--composer-stack-height", `${Math.ceil(viewportGap)}px`);
    app.style.setProperty("--composer-clearance", `${Math.ceil(viewportGap + gap)}px`);
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
        state.completionJobId = workflow.job_id;
        startThinkingSequence(workflow.job_id, "complete");
        renderConversation(data);
        clearTimeout(state.revealTimer);

        const minThinkingMs = 4200;
        const elapsed = state.thinkingStartedAt ? performance.now() - state.thinkingStartedAt : minThinkingMs;
        const remaining = Math.max(0, minThinkingMs - elapsed);

        state.revealTimer = setTimeout(() => {
          flashCompletion();
          state.revealTimer = setTimeout(() => {
            resetThinkingSequence();
            state.revealPendingJobId = null;
            state.completionJobId = null;
            renderConversation(ctx.data);
            requestAnimationFrame(() => {
              updateComposerGeometry();
              const scroller = qs(".app");
              scroller?.scrollTo({top: scroller.scrollHeight, behavior:"smooth"});
              ctx.updateScrollLatest?.();
            });
            sendEvent({type:"ui.response_revealed", job_id:workflow.job_id});
          }, 700);
        }, remaining);
        return;
      }
    } else if (workflow.status !== "complete") {
      clearTimeout(state.revealTimer);
      state.revealPendingJobId = null;
    }

    if (workflow.active) {
      startThinkingSequence(workflow.job_id, workflow.phase);
    }

    if (messagesChanged) {
      renderConversation(data);
    } else if (workflow.active && (workflow.phase !== prevPhase || workflow.job_id !== prevJob)) {
      renderConversation(data);
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
      appScroll?.scrollTo({top: appScroll.scrollHeight, behavior:"smooth"});
    });
    window.addEventListener("resize", updateComposerGeometry, {passive:true});
    ctx.updateScrollLatest = updateScrollLatest;
    updateComposerGeometry();

    document.addEventListener("keydown", event => {
      if (event.key === "Escape") closeHistory();
    });
  }

  sync(ctx.data);

  return () => {
    clearTimeout(state.revealTimer);
    clearTimeout(state.completionTimer);
    clearTimeout(state.scrollTimer);
    stopThinkingSequence();
  };
}
