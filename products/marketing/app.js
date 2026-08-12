const workflowData = {
  open: {
    number: "01 / 05",
    title: "打开文献",
    copy: "把当前真正想理解的文献带进桌面阅读工作台。"
  },
  core: {
    number: "02 / 05",
    title: "看见核心",
    copy: "从你最想知道的内容开始，建立对论文主线的第一层理解。"
  },
  explore: {
    number: "03 / 05",
    title: "选择深入",
    copy: "选中词句或尚未展开的板块，沿着问题进入下一层。"
  },
  verify: {
    number: "04 / 05",
    title: "核对依据",
    copy: "辨认内容依据，并回到相关原文位置核对上下文。"
  },
  keep: {
    number: "05 / 05",
    title: "留下理解",
    copy: "批注、整理、导出或分享这一轮阅读形成的理解。"
  }
};

const resultData = {
  sourceFigure: {
    kicker: "保留原文关系",
    title: "论文原图",
    copy: "自动找到与当前理解相关的原图、表格或图注，连同页码与证据位置放回阅读上下文。",
    use: "薄读呈现：原图、图注与位置关联",
    className: "result-source-figure-preview",
    ariaLabel: "论文原图自动定位插入预览",
    markup: `
      <div class="thin-toolbar"><span>薄读 / 论文原图</span><span>第 4 页 · Fig. 2</span></div>
      <div class="source-figure-card"><img src="assets/program.png" alt="论文原图的示意预览" /><span class="source-figure-marker">当前段落相关</span><p>方法结构 · 原图与图注保持原文身份</p></div>`
  },
  structure: {
    kicker: "生成结构表达",
    title: "结构表达",
    copy: "把论文中的概念、步骤、因果或时间关系生成结构图，让复杂论述有清晰的形状。",
    use: "薄读生成：流程图、思维导图、因果图与时间线",
    className: "result-structure-preview",
    ariaLabel: "薄读生成结构表达预览",
    markup: `
      <div class="structure-canvas"><span class="structure-node structure-node--root">研究问题</span><span class="structure-node structure-node--one">方法</span><span class="structure-node structure-node--two">证据</span><span class="structure-node structure-node--three">结果</span><i class="structure-line structure-line--a"></i><i class="structure-line structure-line--b"></i><i class="structure-line structure-line--c"></i></div><p class="preview-caption">结构由当前文献证据绑定，可继续查看节点依据</p>`
  },
  science: {
    kicker: "生成科学图解",
    title: "科学图解",
    copy: "根据论文中的证据生成受控的电路、物理示意或生物结构图，帮助你观察对象、连接与标注。",
    use: "薄读生成：电路、物理示意与生物结构",
    className: "result-science-preview",
    ariaLabel: "薄读生成科学图解预览",
    markup: `
      <div class="science-diagram"><span class="science-label science-label--input">输入</span><span class="science-box science-box--core">核心对象</span><span class="science-label science-label--output">输出</span><i class="science-arrow science-arrow--a"></i><i class="science-arrow science-arrow--b"></i><small>证据绑定标注</small></div>`
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
  illustration: {
    kicker: "生成证据绑定插图",
    title: "视觉重绘",
    copy: "当原文图像难以直接阅读时，把已核对的结构和标签重绘成清晰的辅助插图，并明确标记它不是论文原图。",
    use: "薄读生成：带证据标签的辅助视觉表达",
    className: "result-illustration-preview",
    ariaLabel: "薄读生成证据绑定辅助插图预览",
    markup: `
      <div class="illustration-stage"><div class="illustration-card"><span class="illustration-badge">AI 辅助插图</span><div class="illustration-shape"></div><div class="illustration-labels"><span>对象 A</span><span>对象 B</span><span>证据 01</span></div></div><p>与原文图清晰区分，标签与证据保持对应</p></div>`
  }
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

const resultButtons = [...document.querySelectorAll("[data-result]")];
const resultKicker = document.querySelector("[data-result-kicker]");
const resultTitle = document.querySelector("[data-result-title]");
const resultCopy = document.querySelector("[data-result-copy]");
const resultUse = document.querySelector("[data-result-use]");
const resultPreview = document.querySelector("[data-result-preview]");
const resultPanel = document.querySelector("#result-panel");

function updateResult(result) {
  const data = resultData[result];
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
