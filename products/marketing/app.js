const workflowData = {
  workspace: {
    number: "01 / 05",
    title: "建立工作区",
    copy: "围绕当前课题整理文献、标签、笔记与阅读上下文。"
  },
  select: {
    number: "02 / 05",
    title: "锁定文献",
    copy: "选择真正需要理解的文献，让后续分析始终围绕明确的材料展开。"
  },
  import: {
    number: "03 / 05",
    title: "解析文献",
    copy: "识别文献结构、段落关系和关键论证，为深入阅读建立基础。"
  },
  ask: {
    number: "04 / 05",
    title: "追问与验证",
    copy: "围绕不理解的地方继续提问，并回到相关原文位置检查依据。"
  },
  artifact: {
    number: "05 / 05",
    title: "生成产物",
    copy: "将理解延展为树状展开、思维导图、问答解析或汇报骨架。"
  }
};

const artifactData = {
  thin: {
    kicker: "逐层阅读",
    title: "薄读",
    copy: "先理解文献最重要的部分，再沿着问题逐层深入。",
    use: "适合：快速建立整体判断",
    className: "artifact-thin-preview",
    markup: `
      <div class="thin-toolbar"><span>薄读</span><span>总述 · 第 0 层</span></div>
      <p>先保留文献中最值得理解的核心，再根据兴趣和疑问，继续进入方法、实验与局限。</p>
      <div class="thin-tokens"><span>深入了解实验</span><span>方法细节</span><span>局限</span></div>`
  },
  tree: {
    kicker: "从整体到细节",
    title: "树形展开",
    copy: "将章节、论点、方法和结论拆解为可以继续探索的理解路径。",
    use: "适合：系统精读与逻辑梳理",
    className: "tree-preview",
    markup: `
      <img class="artifact-visual" src="assets/tree-visual.svg" alt="文献主线拆解为研究问题、核心方法、实验设计和结论与局限" />`
  },
  map: {
    kicker: "结构化表达",
    title: "思维导图",
    copy: "把文献中的问题、方法、证据与启发组织成一张知识骨架。",
    use: "适合：建立知识骨架",
    className: "map-preview",
    markup: `
      <img class="artifact-visual" src="assets/map-visual.svg" alt="文献问题、方法、证据与启发组成知识关系图" />`
  },
  ppt: {
    kicker: "面向表达",
    title: "PPT",
    copy: "将文献理解整理为适合组会、课堂或研究汇报的表达脉络。",
    use: "适合：汇报与交流",
    className: "ppt-preview",
    markup: `
      <p class="ppt-eyebrow">LITEASYCLAW / LITERATURE BRIEF</p><h4>文献理解<br />汇报骨架</h4><span class="ppt-bar"></span><span class="ppt-page">01 / 08</span>`
  },
  qa: {
    kicker: "带着问题阅读",
    title: "问答式解析",
    copy: "围绕真正不理解的地方提问，让解释始终贴近文献上下文。",
    use: "适合：针对性理解与复盘",
    className: "qa-preview",
    markup: `
      <div class="qa-message question">这一结论的原文依据在哪里？</div>
      <div class="qa-message answer">可回到相关段落与上下文继续检查，让理解不止停留在一段结论。<br /><span class="qa-cite">引用定位：相关段落</span></div>`
  }
};

const header = document.querySelector("[data-header]");
const menuButton = document.querySelector("[data-menu-toggle]");
const navigation = document.querySelector("[data-site-nav]");

window.addEventListener("scroll", () => {
  header.classList.toggle("is-scrolled", window.scrollY > 24);
}, { passive: true });

menuButton.addEventListener("click", () => {
  const isOpen = menuButton.getAttribute("aria-expanded") === "true";
  menuButton.setAttribute("aria-expanded", String(!isOpen));
  navigation.classList.toggle("is-open", !isOpen);
});

navigation.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    menuButton.setAttribute("aria-expanded", "false");
    navigation.classList.remove("is-open");
  });
});

const workflowButtons = [...document.querySelectorAll("[data-step]")];
const workflowTitle = document.querySelector("[data-workflow-title]");
const workflowCopy = document.querySelector("[data-workflow-copy]");
const workflowNumber = document.querySelector(".step-number");
const workflowMedia = document.querySelector("[data-workflow-media]");
const workflowPanel = document.querySelector("#workflow-panel");

function updateWorkflow(step) {
  const data = workflowData[step];
  workflowButtons.forEach((button) => {
    const active = button.dataset.step === step;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  workflowNumber.textContent = data.number;
  workflowTitle.textContent = data.title;
  workflowCopy.textContent = data.copy;
  workflowMedia.dataset.focus = step;
  workflowPanel.setAttribute("aria-labelledby", `step-${step}`);
}

workflowButtons.forEach((button) => {
  button.addEventListener("click", () => updateWorkflow(button.dataset.step));
  button.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = workflowButtons.indexOf(button);
    const direction = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (currentIndex + direction + workflowButtons.length) % workflowButtons.length;
    workflowButtons[nextIndex].focus();
    updateWorkflow(workflowButtons[nextIndex].dataset.step);
  });
});

const artifactButtons = [...document.querySelectorAll("[data-artifact]")];
const artifactKicker = document.querySelector("[data-artifact-kicker]");
const artifactTitle = document.querySelector("[data-artifact-title]");
const artifactCopy = document.querySelector("[data-artifact-copy]");
const artifactUse = document.querySelector("[data-artifact-use]");
const artifactPreview = document.querySelector("[data-artifact-preview]");
const artifactPanel = document.querySelector("#artifact-panel");

function updateArtifact(artifact) {
  const data = artifactData[artifact];
  artifactButtons.forEach((button) => {
    const active = button.dataset.artifact === artifact;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  artifactKicker.textContent = data.kicker;
  artifactTitle.textContent = data.title;
  artifactCopy.textContent = data.copy;
  artifactUse.textContent = data.use;
  artifactPreview.className = `artifact-preview ${data.className}`;
  artifactPreview.innerHTML = data.markup;
  artifactPanel.setAttribute("aria-labelledby", `artifact-${artifact}`);
}

artifactButtons.forEach((button) => {
  button.addEventListener("click", () => updateArtifact(button.dataset.artifact));
  button.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = artifactButtons.indexOf(button);
    const direction = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (currentIndex + direction + artifactButtons.length) % artifactButtons.length;
    artifactButtons[nextIndex].focus();
    updateArtifact(artifactButtons[nextIndex].dataset.artifact);
  });
});

const waitlistUrl = window.LITEASY_WAITLIST_URL || "";
const waitlistForm = document.querySelector("[data-waitlist-form]");
const formStatus = document.querySelector("[data-form-status]");

waitlistForm.addEventListener("submit", (event) => {
  if (waitlistUrl) {
    waitlistForm.action = waitlistUrl;
    waitlistForm.method = "get";
    return;
  }
  event.preventDefault();
  formStatus.textContent = "体验申请入口尚未开放。开放后可在这里提交申请。";
});
