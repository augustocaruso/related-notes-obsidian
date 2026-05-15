import { Plugin, TFile, WorkspaceLeaf, Notice, setIcon } from "obsidian";
import { RelatedNotesSettings, DEFAULT_SETTINGS } from "./types";
import { RelatedNotesSettingTab } from "./settings";
import { GeminiEmbeddingProvider } from "./embeddings/GeminiEmbeddingProvider";
import { JsonVectorStore } from "./store/JsonVectorStore";
import { VaultIndexer } from "./indexing/VaultIndexer";
import { RelatedNotesService } from "./related/RelatedNotesService";
import { RelatedNotesView, RELATED_NOTES_VIEW_TYPE } from "./ui/RelatedNotesView";
import { writeWorkbenchExport } from "./export/WorkbenchExport";

export default class RelatedNotesPlugin extends Plugin {
  settings!: RelatedNotesSettings;
  store!: JsonVectorStore;
  indexer!: VaultIndexer;
  service!: RelatedNotesService;
  embeddingProvider!: GeminiEmbeddingProvider;

  statusBarItem!: HTMLElement;

  async onload() {
    await this.loadSettings();

    this.statusBarItem = this.addStatusBarItem();
    this.updateStatusBar("idle");

    this.store = new JsonVectorStore(this);
    await this.store.init();

    this.updateProvider();
    this.service = new RelatedNotesService(this.store);

    this.registerView(
      RELATED_NOTES_VIEW_TYPE,
      (leaf) => {
        const view = new RelatedNotesView(leaf, this);
        view.setService(this.service);
        return view;
      }
    );

    this.addSettingTab(new RelatedNotesSettingTab(this.app, this));

    this.addRibbonIcon("links-coming-in", "Open Related Notes", () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-related-notes",
      name: "Open sidebar",
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: "reindex-vault",
      name: "Reindex vault",
      callback: () => this.reindexVault(),
    });

    this.addCommand({
      id: "export-workbench-related-notes",
      name: "Export Medical Notes Workbench related notes",
      callback: () => this.exportWorkbenchRelatedNotes(),
    });

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        this.updateSidebar(file);
      })
    );

    // Initial sidebar update if a file is already open
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile) {
        this.updateSidebar(activeFile);
    }
  }

  updateStatusBar(status: "idle" | "indexing" | "error" | "complete", message?: string, progress?: number) {
    this.statusBarItem.empty();
    const container = this.statusBarItem.createDiv({ cls: "related-notes-status-bar" });
    
    if (status === "indexing") {
      const text = message || "Indexing...";
      
      // Progress container
      const progContainer = container.createDiv({ cls: "related-notes-progress-container" });
      const bar = progContainer.createDiv({ cls: "related-notes-progress-bar" });
      
      if (progress !== undefined) {
        bar.setAttr("style", `width: ${progress * 100}%`);
      } else {
        container.addClass("is-loading");
      }
      
      const icon = container.createSpan({ cls: "related-notes-status-icon" });
      setIcon(icon, "refresh-cw");
      container.createSpan({ text, cls: "related-notes-status-text" });
    } else if (status === "error") {
      const icon = container.createSpan({ cls: "related-notes-status-icon" });
      setIcon(icon, "alert-triangle");
      container.createSpan({ text: message || "API Error", cls: "related-notes-status-text" });
      container.addClass("is-error");
    } else if (status === "complete") {
      const icon = container.createSpan({ cls: "related-notes-status-icon" });
      setIcon(icon, "check-circle-2");
      container.createSpan({ text: "Index ready", cls: "related-notes-status-text" });
    } else {
      const icon = container.createSpan({ cls: "related-notes-status-icon" });
      setIcon(icon, "links-coming-in");
      container.createSpan({ text: "Related Notes", cls: "related-notes-status-text" });
    }
  }

  async loadSettings() {
    let data = await this.loadData();
    
    // Fallback: manually read data.json if loadData() is empty
    if (!data || Object.keys(data).length === 0) {
        const dataPath = `${this.app.vault.configDir}/plugins/${this.manifest.id}/data.json`;
        if (await this.app.vault.adapter.exists(dataPath)) {
            console.log("[RelatedNotes] loadData() was empty, attempting manual read from:", dataPath);
            try {
                const content = await this.app.vault.adapter.read(dataPath);
                data = JSON.parse(content);
            } catch (e) {
                console.error("[RelatedNotes] Manual settings read failed:", e);
            }
        }
    }

    console.log("[RelatedNotes] Settings after load:", data ? "Found" : "Missing");
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    
    if (this.settings.geminiApiKey) {
        console.log(`[RelatedNotes] Gemini API Key loaded (length: ${this.settings.geminiApiKey.length})`);
    } else {
        console.warn("[RelatedNotes] Gemini API Key is still missing.");
    }
  }

  async saveSettings() {
    console.log("[RelatedNotes] Saving settings...", { 
        keyLength: this.settings.geminiApiKey?.length || 0,
        limit: this.settings.relatedNotesLimit 
    });
    await this.saveData(this.settings);
    // Refresh provider if key changed
    this.updateProvider();
  }

  updateProvider() {
      console.log("[RelatedNotes] Updating embedding provider and indexer...");
      this.embeddingProvider = new GeminiEmbeddingProvider(this.settings.geminiApiKey);
      this.indexer = new VaultIndexer(this.app, this.store, this.embeddingProvider);
  }

  async activateView() {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(RELATED_NOTES_VIEW_TYPE);

    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      await leaf?.setViewState({ type: RELATED_NOTES_VIEW_TYPE, active: true });
    }

    if (leaf) {
        workspace.revealLeaf(leaf);
        this.updateSidebar(workspace.getActiveFile());
    }
  }

  updateSidebar(file: TFile | null) {
    const leaves = this.app.workspace.getLeavesOfType(RELATED_NOTES_VIEW_TYPE);
    for (const leaf of leaves) {
      if (leaf.view instanceof RelatedNotesView) {
        leaf.view.setCurrentFile(file);
      }
    }
  }

  async reindexVault() {
    new Notice("Indexing vault... please wait.");
    this.updateStatusBar("indexing", "Starting...");
    
    try {
        await this.indexer.reindexVault((current, total) => {
            const pct = current / total;
            this.updateStatusBar("indexing", `${current}/${total}`, pct);
        });
        this.updateStatusBar("complete");
        new Notice("Vault indexing complete!");
        this.updateSidebar(this.app.workspace.getActiveFile());
        await this.exportWorkbenchRelatedNotes();
    } catch (e: any) {
        let msg = "Indexing Failed";
        if (e.message?.includes("quota")) {
            msg = "Daily Quota Reached";
        } else if (e.message?.includes("429")) {
            msg = "Rate Limit Reached";
        }
        
        this.updateStatusBar("error", msg);
        new Notice(`Indexing paused: ${msg}. Progress saved.`);
        console.error(e);
    }
  }

  async indexCurrentFile(file?: TFile | null) {
    const target = file ?? this.app.workspace.getActiveFile();

    if (!target || target.extension !== "md") {
      new Notice("Open a Markdown note to index it.");
      return;
    }

    this.updateStatusBar("indexing", "Indexing current note", 0);

    try {
      await this.indexer.indexFile(target);
      await this.store.flush();
      this.updateStatusBar("complete");
      this.updateSidebar(target);
      await this.exportWorkbenchRelatedNotes();
      new Notice(`Indexed ${target.basename}`);
    } catch (e: any) {
      const msg = e.message?.includes("429") || e.message?.includes("quota")
        ? "Rate limit reached"
        : "Indexing failed";
      this.updateStatusBar("error", msg);
      new Notice(msg);
      console.error(e);
    }
  }

  openSettings() {
    const setting = (this.app as any).setting;
    if (!setting?.open || !setting?.openTabById) {
      new Notice("Open Obsidian settings, then Related Notes, to configure this plugin.");
      return;
    }

    setting?.open?.();
    setting?.openTabById?.(this.manifest.id);
  }

  async exportWorkbenchRelatedNotes() {
    try {
      const result = await writeWorkbenchExport({
        app: this.app,
        plugin: this,
        store: this.store,
        service: this.service,
        limit: this.settings.relatedNotesLimit,
      });
      new Notice(`Workbench export ready: ${result.noteCount} notes, ${result.edgeCount} edges.`);
      console.log("[RelatedNotes] Workbench export written:", result);
    } catch (e) {
      console.error("[RelatedNotes] Workbench export failed:", e);
      new Notice("Workbench export failed. See console for details.");
    }
  }
}
