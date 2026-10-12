const workflowData = {
  open: {
    image: "assets/new/workflow-1.webp",
    original: "assets/new/workflow-1.png",
    alt: "从文献库打开 Q-VLM 论文，PDF 原文与批注在同一工作台中显示",
    detail: "文献库与 PDF 原文",
    number: "01 / 05",
    title: "打开文献",
    copy: "把当前真正想理解的文献带进桌面阅读工作台。"
  },
  core: {
    image: "assets/new/workflow-2.webp",
    original: "assets/new/workflow-2.png",
    alt: "Q-VLM 薄读结果中的一句话总览、核心方法与可深入概念",
    detail: "一句话总览与核心方法",
    number: "02 / 05",
    title: "看见核心",
    copy: "从你最想知道的内容开始，建立对论文主线的第一层理解。"
  },
  explore: {
    image: "assets/new/workflow-3.webp",
    original: "assets/new/workflow-3.png",
    alt: "深入跨层依赖与块级搜索，阅读核心机制及下一层概念",
    detail: "沿着概念进入下一层",
    number: "03 / 05",
    title: "选择深入",
    copy: "选中词句或尚未展开的板块，沿着问题进入下一层。"
  },
  verify: {
    image: "assets/new/workflow-4.webp",
    original: "assets/new/workflow-4.png",
    alt: "薄读结果中的论文原图、实验表格及原文第 7 页标记",
    detail: "原图、表格与原文页码",
    number: "04 / 05",
    title: "核对依据",
    copy: "辨认内容依据，并回到相关原文位置核对上下文。"
  },
  keep: {
    image: "assets/new/workflow-5.webp",
    original: "assets/new/workflow-5.png",
    alt: "论文原文与研究白板并排，笔记卡片保留原文和个人理解",
    detail: "笔记、原文与研究白板",
    number: "05 / 05",
    title: "留下理解",
    copy: "把原文与自己的理解留在笔记和研究白板中，继续整理这一轮阅读。"
  }
};

const resultData = {
  sourceFigure: {
    kicker: "保留原文关系",
    title: "论文原图",
    copy: "在阅读上下文中保留论文原文、图表与图注，结合选区和批注核对研究内容。",
    use: "原文阅读：页面配色、选区与批注",
    className: "result-source-figure-preview",
    ariaLabel: "论文原文阅读界面预览",
    markup: `<img class="result-product-image" src="assets/new/paper-read.webp" loading="lazy" decoding="async" alt="Q-VLM 原文阅读界面：护眼配色保留图片原色，原文选区和批注清晰可见" />`
  },
  structure: {
    kicker: "生成结构表达",
    title: "结构表达",
    copy: "把论文中的概念、步骤、因果或时间关系生成结构图，让复杂论述有清晰的形状。",
    use: "薄读生成：流程图、思维导图、因果图与时间线",
    className: "result-structure-preview",
    ariaLabel: "薄读生成结构表达预览",
    markup: `<img class="result-product-image" src="assets/new/mindmap.webp" loading="lazy" decoding="async" alt="Q-VLM 实际生成的文献思维导图：核心结论、关键链条、关键数据和实验依据按层级展开" />`
  },
  science: {
    kicker: "生成科学图解",
    title: "科学图解",
    copy: "根据论文中的证据生成受控的电路、物理示意或生物结构图，帮助你观察对象、连接与标注。",
    use: "薄读生成：电路、物理示意与生物结构",
    className: "result-science-preview",
    ariaLabel: "薄读生成科学图解预览",
    markup: `<img class="science-product-image" src="assets/science-optics.svg" loading="lazy" alt="简洁凸透镜光路示意：三束平行光通过透镜后汇聚于焦点 F" />`
  },
  math: {
    kicker: "生成数学与几何表达",
    title: "数学与几何",
    copy: "把论文里的函数、几何关系和空间结构生成可观察的表达，并支持缩放、旋转或查看关键参数。",
    use: "薄读生成：函数图像、二维几何与三维几何",
    className: "result-math-preview",
    ariaLabel: "薄读生成数学与几何表达预览",
    markup: `
      <div class="math-stage"><div class="math-axes"><i></i><i></i><b>f(x)</b><span>可缩放 · 可旋转 · 可选中</span></div><div class="math-control">参数 <strong>a = 2.0</strong><em></em></div></div>`
  },
  process: {
    kicker: "生成过程演示",
    title: "过程演示",
    copy: "把物理变化或化学反应拆成可逐步查看的过程，配合方程、事件和证据标记观察变化。",
    use: "薄读生成：物理过程与化学反应过程",
    className: "result-process-preview",
    ariaLabel: "薄读生成过程演示预览",
    markup: `
      <div class="process-stage"><div class="process-scene"><span>初始状态</span><i>&#8594;</i><b>变化中</b><i>&#8594;</i><span>结果状态</span></div><div class="process-timeline"><span></span><b></b><i></i></div><p>逐帧查看 · 关键事件与证据绑定</p></div>`
  },

};

const associationData = {
  anchors: {
    kicker: "从正文里开始",
    title: "标出概念",
    copy: "点开“相关推荐”，正文中的关键概念会变成可以继续探索的入口。",
    use: "相关推荐 · 概念锚点 · 原位置保留",
    canvasNote: "点击概念锚点，关联推荐从当前正文位置展开。",
    className: "association-anchors-preview",
    ariaLabel: "正文中的相关推荐概念标记预览",
    markup: `<div class="association-toolbar"><span>薄读 / 正文</span><button type="button">相关推荐</button></div><p>Late interaction 让查询与文档 token 保持细粒度匹配。</p><div class="association-anchor-chip">细粒度匹配 <span>3 篇关联论文</span></div><div class="association-anchor-chip association-anchor-chip--second">Late interaction <span>查看关联</span></div>`
  },
  focus: {
    kicker: "只看当前线索",
    title: "聚焦关联",
    copy: "选择一个概念后，其他正文变得安静，相关锚点、连线和文献节点留在视野中央。",
    use: "聚焦概念 · 其他内容弱化 · 关联线索突出",
    canvasNote: "当前概念被高亮，其他正文淡出，关联节点和连线成为视觉主线。",
    className: "association-focus-preview",
    ariaLabel: "聚焦概念及其关联文献预览",
    markup: `<div class="association-toolbar"><span>正在聚焦「Late interaction」</span><button type="button">返回正文</button></div><div class="association-graph-mini"><span class="association-node-mini association-node-mini--root">Late interaction</span><span class="association-node-mini association-node-mini--one">方法来源</span><span class="association-node-mini association-node-mini--two">后续研究</span><span class="association-node-mini association-node-mini--three">相关概念</span><i></i><i></i><i></i></div>`
  },
  paper: {
    kicker: "在路径上阅读",
    title: "打开文献",
    copy: "点击关联文献节点，阅读卡片会在当前路径中打开，告诉你它与正在阅读的内容如何相关。",
    use: "关联文献 · 关系类型 · 推荐理由",
    canvasNote: "点击论文节点，查看它与当前概念的关系和推荐理由。",
    className: "association-paper-preview",
    ariaLabel: "关联文献阅读卡片预览",
    markup: `<div class="association-toolbar"><span>关联文献 / 1 of 3</span><button type="button">返回关联图</button></div><div class="association-reading-card"><p class="association-card-label">CITES TARGET</p><h4>Efficient and Effective Passage Search</h4><p>从当前概念继续，查看这篇文献如何承接方法脉络。</p><div><span>推荐理由</span><strong>方法关系 · 高相关</strong></div></div>`
  },
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

const workflowButtons = [...document.querySelectorAll('[role="tab"][data-step]')];
const workflowTitle = document.querySelector("[data-workflow-title]");
const workflowCopy = document.querySelector("[data-workflow-copy]");
const workflowNumber = document.querySelector(".step-number");
const workflowMedia = document.querySelector("[data-workflow-media]");
const workflowPanel = document.querySelector("#workflow-panel");

const workflowScenes = [...document.querySelectorAll("[data-workflow-scene]")];
const workflowDetail = document.querySelector("[data-workflow-detail]");
const workflowOriginal = document.querySelector("[data-workflow-original]");
let workflowRequest = 0;

// Cache requested screenshots while keeping the current picture visible during loading.
const workflowImages = new Map();
function loadWorkflowImage(step) {
  if (!workflowImages.has(step)) {
    const image = new Image();
    image.src = workflowData[step].image;
    workflowImages.set(step, image.decode().then(() => true).catch(() => false));
  }
  return workflowImages.get(step);
}

// Warm remaining steps sequentially only when the workflow approaches the viewport.
const workflowObserver = new IntersectionObserver(async (entries, observer) => {
  if (!entries.some((entry) => entry.isIntersecting)) return;
  observer.disconnect();
  for (const step of Object.keys(workflowData)) await loadWorkflowImage(step);
}, { rootMargin: "200px" });
workflowObserver.observe(workflowPanel);

async function updateWorkflow(step) {
  const request = ++workflowRequest;
  workflowPanel.setAttribute("aria-busy", "true");
  const loaded = await loadWorkflowImage(step);
  if (request !== workflowRequest) return;
  workflowPanel.setAttribute("aria-busy", "false");
  if (!loaded) return;
  const data = workflowData[step];
  const current = workflowScenes.find((scene) => scene.classList.contains("is-active"));
  if (current.dataset.step !== step) {
    const incoming = workflowScenes.find((scene) => scene !== current);
    const image = incoming.querySelector("img");
    image.src = data.image;
    image.alt = data.alt;
    incoming.dataset.step = step;
    incoming.setAttribute("aria-hidden", "false");
    // Commit the incoming position before its fade/pan transition begins.
    void incoming.offsetWidth;
    incoming.classList.add("is-active");
    current.classList.remove("is-active");
    current.setAttribute("aria-hidden", "true");
  }
  workflowButtons.forEach((button) => {
    const active = button.dataset.step === step;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  workflowNumber.textContent = data.number;
  workflowTitle.textContent = data.title;
  workflowCopy.textContent = data.copy;
  workflowDetail.textContent = data.detail;
  workflowOriginal.href = data.original;
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

const resultButtons = [...document.querySelectorAll("[data-result]")];
const resultKicker = document.querySelector("[data-result-kicker]");
const resultTitle = document.querySelector("[data-result-title]");
const resultCopy = document.querySelector("[data-result-copy]");
const resultUse = document.querySelector("[data-result-use]");
const resultPreview = document.querySelector("[data-result-preview]");
const resultPanel = document.querySelector("#result-panel");

function updateResult(result) {
  const data = resultData[result];
  resultPanel.dataset.resultState = result;
  resultButtons.forEach((button) => {
    const active = button.dataset.result === result;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  resultKicker.textContent = data.kicker;
  resultTitle.textContent = data.title;
  resultCopy.textContent = data.copy;
  resultUse.textContent = data.use;
  resultPreview.className = `artifact-preview result-preview ${data.className}`;
  resultPreview.innerHTML = data.markup;
  resultPreview.setAttribute("aria-label", data.ariaLabel);
  resultPanel.setAttribute("aria-labelledby", `result-${result}`);
}

resultButtons.forEach((button) => {
  button.addEventListener("click", () => updateResult(button.dataset.result));
  button.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = resultButtons.indexOf(button);
    const direction = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (currentIndex + direction + resultButtons.length) % resultButtons.length;
    resultButtons[nextIndex].focus();
    updateResult(resultButtons[nextIndex].dataset.result);
  });
});

const associationButtons = [...document.querySelectorAll("[data-association]")];
const associationKicker = document.querySelector("[data-association-kicker]");
const associationTitle = document.querySelector("[data-association-title]");
const associationCopy = document.querySelector("[data-association-copy]");
const associationUse = document.querySelector("[data-association-use]");
const associationPreview = document.querySelector("[data-association-preview]");
const associationPanel = document.querySelector("#association-panel");
const associationCanvas = document.querySelector("[data-association-canvas]");
const associationCanvasNote = document.querySelector("[data-association-canvas-note]");

function updateAssociation(state) {
  const data = associationData[state];
  associationButtons.forEach((button) => {
    const active = button.dataset.association === state;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  associationKicker.textContent = data.kicker;
  associationTitle.textContent = data.title;
  associationCopy.textContent = data.copy;
  associationUse.textContent = data.use;
  associationCanvas?.classList.toggle("is-focus", state === "focus");
  associationCanvas?.classList.toggle("is-paper", state === "paper");
  associationCanvasNote.textContent = data.canvasNote;
  associationPanel.setAttribute("data-association-state", state);
}

associationButtons.forEach((button) => {
  button.addEventListener("click", () => updateAssociation(button.dataset.association));
  button.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = associationButtons.indexOf(button);
    const direction = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (currentIndex + direction + associationButtons.length) % associationButtons.length;
    associationButtons[nextIndex].focus();
    updateAssociation(associationButtons[nextIndex].dataset.association);
  });
});

const waitlistUrl = window.LITEASY_WAITLIST_URL || "/api/waitlist";
const waitlistForm = document.querySelector("[data-waitlist-form]");
const formStatus = document.querySelector("[data-form-status]");
const submitButton = waitlistForm.querySelector('button[type="submit"]');
const submitButtonLabel = submitButton.innerHTML;

document.querySelectorAll("[data-download-link]").forEach((link) => {
  link.addEventListener("click", () => {
    formStatus.textContent = "安装包面向已提交体验申请的用户开放。请先完成下方申请，审核信息提交后即可获取当前版本。";
  });
});

waitlistForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!waitlistForm.reportValidity()) return;

  submitButton.disabled = true;
  submitButton.textContent = "正在提交申请...";
  formStatus.textContent = "";

  try {
    const response = await fetch(waitlistUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(waitlistForm)))
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok || !result.ok) {
      throw new Error(result.error || "申请提交失败，请稍后重试。");
    }

    if (!result.downloadUrl) {
      formStatus.textContent = result.message || "体验申请已提交。安装包准备完成后，我们将通过邮件通知你。";
      return;
    }

    formStatus.textContent = "体验申请已提交，安装包即将开始下载。";
    window.location.assign(result.downloadUrl);
  } catch (error) {
    formStatus.textContent = error.message || "申请提交失败，请稍后重试。";
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = submitButtonLabel;
  }
});
