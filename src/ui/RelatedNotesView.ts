import {
  ButtonComponent,
  ExtraButtonComponent,
  ItemView,
  Menu,
  Notice,
  TFile,
  WorkspaceLeaf,
  setIcon,
} from "obsidian";
import type RelatedNotesPlugin from "../main";
import { RelatedNotesService } from "../related/RelatedNotesService";
import { NoteVectorRecord } from "../types";
import { formatScore, getScoreTone, pathToWikilink } from "./viewHelpers";

export const RELATED_NOTES_VIEW_TYPE = "related-notes-view";

const NARROW_THRESHOLD_PX = 260;

type RelatedNoteResult = NoteVectorRecord & { score: number };

export class RelatedNotesView extends ItemView {
  private service: RelatedNotesService | null = null;
  private currentFile: TFile | null = null;
  private renderToken = 0;
  private widthObserver: ResizeObserver | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: RelatedNotesPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return RELATED_NOTES_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Related Notes";
  }

  getIcon(): string {
    return "links-coming-in";
  }

  setService(service: RelatedNotesService) {
    this.service = service;
  }

  async onOpen() {
    this.attachWidthObserver();
    this.updateView();
  }

  async onClose() {
    this.widthObserver?.disconnect();
    this.widthObserver = null;
  }

  setCurrentFile(file: TFile | null) {
    const next = file?.extension === "md" ? file : null;
    if (next?.path !== this.currentFile?.path) {
      const list = this.containerEl.querySelector(".related-notes-list");
      list?.classList.add("is-fading");
    }
    this.currentFile = next;
    this.updateView();
  }

  async updateView() {
    const token = ++this.renderToken;
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("related-notes-view");

    this.renderHeader(container);

    if (!this.currentFile) {
      this.renderState(container, {
        icon: "file-text",
        title: "Open a Markdown note",
        description: "Related notes appear here when a note is active.",
      });
      return;
    }

    if (!this.plugin.settings.geminiApiKey) {
      this.renderState(container, {
        icon: "key-round",
        title: "Gemini API key missing",
        description: "Add your API key before indexing or searching related notes.",
        primaryAction: { label: "Open settings", onClick: () => this.plugin.openSettings() },
      });
      return;
    }

    if (!this.service) {
      this.renderState(container, {
        icon: "alert-circle",
        title: "Related Notes is not ready",
        description: "The related notes service has not initialized yet.",
      });
      return;
    }

    const skeleton = this.renderSkeleton(container);

    const result = await this.service.getRelatedNotes(
      this.currentFile.path,
      this.plugin.settings.relatedNotesLimit
    );

    if (token !== this.renderToken) return;
    skeleton.remove();

    if (result.status === "not_indexed") {
      this.renderState(container, {
        icon: "scan-search",
        title: "This note is not indexed yet",
        description: "Index this note now, or reindex the vault to refresh all related-note data.",
        primaryAction: { label: "Index this note", onClick: () => this.plugin.indexCurrentFile(this.currentFile) },
        secondaryAction: { label: "Reindex vault", onClick: () => this.plugin.reindexVault() },
      });
      return;
    }

    if (result.status === "error") {
      this.renderState(container, {
        icon: "alert-triangle",
        title: "Could not load related notes",
        description: "Try refreshing the panel or rebuilding the index.",
        primaryAction: { label: "Retry", onClick: () => this.updateView() },
        secondaryAction: { label: "Reindex vault", onClick: () => this.plugin.reindexVault() },
      });
      return;
    }

    if (result.notes.length === 0) {
      this.renderState(container, {
        icon: "search-x",
        title: "No related notes found",
        description: "The current note is indexed, but no similar notes were found.",
        primaryAction: { label: "Refresh", onClick: () => this.updateView() },
      });
      return;
    }

    this.renderResults(container, result.notes);
  }

  private renderHeader(container: HTMLElement) {
    const header = container.createDiv({ cls: "related-notes-header" });

    const top = header.createDiv({ cls: "related-notes-header-top" });
    const titleRow = top.createDiv({ cls: "related-notes-title-row" });
    const titleIcon = titleRow.createSpan({ cls: "related-notes-title-icon" });
    setIcon(titleIcon, "links-coming-in");
    titleRow.createEl("h4", { text: "Related Notes", cls: "related-notes-title" });

    const topActions = top.createDiv({ cls: "related-notes-toolbar" });
    this.addIconButton(topActions, "settings", "Open settings", () => this.plugin.openSettings());

    const contextBar = header.createDiv({ cls: "related-notes-context-bar" });
    const chip = contextBar.createDiv({ cls: "related-notes-context-chip" });
    const chipIcon = chip.createSpan({ cls: "related-notes-context-chip-icon" });
    setIcon(chipIcon, this.currentFile ? "file-text" : "file");
    chip.createSpan({
      text: this.currentFile ? this.currentFile.basename : "No active note",
      cls: "related-notes-context-chip-text",
    });
    if (!this.currentFile) chip.addClass("is-empty");

    const contextActions = contextBar.createDiv({ cls: "related-notes-toolbar" });
    this.addIconButton(contextActions, "refresh-cw", "Refresh results", () => this.updateView());
    this.addIconButton(contextActions, "more-horizontal", "More actions", (event) =>
      this.openOverflowMenu(event)
    );
  }

  private openOverflowMenu(event: MouseEvent | undefined) {
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle("Index current note")
        .setIcon("scan-search")
        .setDisabled(!this.currentFile)
        .onClick(() => this.plugin.indexCurrentFile(this.currentFile))
    );
    menu.addItem((item) =>
      item
        .setTitle("Index missing notes")
        .setIcon("list-plus")
        .onClick(() => this.plugin.indexMissingNotes())
    );
    menu.addItem((item) =>
      item
        .setTitle("Reindex vault")
        .setIcon("database-zap")
        .onClick(() => this.plugin.reindexVault())
    );

    if (event) {
      menu.showAtMouseEvent(event);
    } else {
      menu.showAtPosition({ x: 0, y: 0 });
    }
  }

  private renderResults(container: HTMLElement, notes: RelatedNoteResult[]) {
    const summary = container.createDiv({ cls: "related-notes-summary" });
    summary.setText(`${notes.length} related note${notes.length === 1 ? "" : "s"}`);

    const list = container.createDiv({ cls: "related-notes-list" });

    for (const note of notes) {
      this.renderResultRow(list, note);
    }
  }

  private renderResultRow(list: HTMLElement, note: RelatedNoteResult) {
    const row = list.createDiv({ cls: "related-notes-row" });
    row.addClass(`is-score-${getScoreTone(note.score)}`);
    row.setAttr("role", "button");
    row.setAttr("tabindex", "0");
    row.setAttr("aria-label", `Open ${note.title}`);

    row.addEventListener("click", (event) => {
      const newPane = event.metaKey || event.ctrlKey;
      this.openNote(note.path, newPane);
    });

    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        const newPane = event.metaKey || event.ctrlKey;
        this.openNote(note.path, newPane);
      }
    });

    const body = row.createDiv({ cls: "related-notes-row-body" });
    const titleLine = body.createDiv({ cls: "related-notes-row-title-line" });
    titleLine.createDiv({ text: note.title, cls: "related-notes-row-title" });
    titleLine.createSpan({ text: formatScore(note.score), cls: "related-notes-score-text" });

    if (note.folder) {
      body.createDiv({ text: note.folder, cls: "related-notes-row-meta" });
    }

    if (note.preview) {
      const cleaned = note.preview.replace(/^#+\s*/, "").trim();
      if (cleaned && cleaned.toLowerCase() !== note.title.toLowerCase()) {
        body.createDiv({ text: cleaned, cls: "related-notes-row-preview" });
      }
    }

    const actions = row.createDiv({ cls: "related-notes-row-actions" });
    this.addIconButton(actions, "columns-2", "Open in new pane", (event) => {
      event?.stopPropagation();
      this.openNote(note.path, true);
    });
    this.addIconButton(actions, "copy", "Copy wikilink", (event) => {
      event?.stopPropagation();
      this.copyWikilink(note);
    });
  }

  private renderSkeleton(container: HTMLElement): HTMLElement {
    const wrapper = container.createDiv({ cls: "related-notes-skeleton" });
    for (let i = 0; i < 3; i++) {
      const row = wrapper.createDiv({ cls: "related-notes-skeleton-row" });
      row.createDiv({ cls: "related-notes-skeleton-bar is-medium" });
      row.createDiv({ cls: "related-notes-skeleton-bar is-short" });
    }
    return wrapper;
  }

  private renderState(
    container: HTMLElement,
    options: {
      icon: string;
      title: string;
      description: string;
      primaryAction?: { label: string; onClick: () => void | Promise<void> };
      secondaryAction?: { label: string; onClick: () => void | Promise<void> };
    }
  ): HTMLElement {
    const state = container.createDiv({ cls: "related-notes-state" });

    const plate = state.createDiv({ cls: "related-notes-state-icon-plate" });
    setIcon(plate, options.icon);
    state.createEl("h5", { text: options.title, cls: "related-notes-state-title" });
    state.createEl("p", { text: options.description, cls: "related-notes-state-description" });

    if (options.primaryAction || options.secondaryAction) {
      const actions = state.createDiv({ cls: "related-notes-state-actions" });

      if (options.primaryAction) {
        new ButtonComponent(actions)
          .setButtonText(options.primaryAction.label)
          .setCta()
          .onClick(options.primaryAction.onClick);
      }

      if (options.secondaryAction) {
        new ButtonComponent(actions)
          .setButtonText(options.secondaryAction.label)
          .onClick(options.secondaryAction.onClick);
      }
    }

    return state;
  }

  private addIconButton(
    parent: HTMLElement,
    iconName: string,
    tooltip: string,
    onClick: (event?: MouseEvent) => void | Promise<void>
  ) {
    const btn = new ExtraButtonComponent(parent).setIcon(iconName).setTooltip(tooltip);
    btn.extraSettingsEl.setAttr("aria-label", tooltip);
    btn.extraSettingsEl.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick(event);
    });
    return btn;
  }

  private attachWidthObserver() {
    if (typeof ResizeObserver === "undefined") return;
    const target = this.containerEl.children[1] as HTMLElement;
    if (!target) return;
    this.widthObserver?.disconnect();
    this.widthObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        target.toggleClass("is-narrow", width < NARROW_THRESHOLD_PX);
      }
    });
    this.widthObserver.observe(target);
  }

  private openNote(path: string, newPane: boolean) {
    this.app.workspace.openLinkText(path, "", newPane);
  }

  private async copyWikilink(note: RelatedNoteResult) {
    await navigator.clipboard.writeText(pathToWikilink(note.path, note.title));
    new Notice("Wikilink copied");
  }
}
