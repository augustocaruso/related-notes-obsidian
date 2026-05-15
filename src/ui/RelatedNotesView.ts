import {
  ButtonComponent,
  ExtraButtonComponent,
  ItemView,
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

type RelatedNoteResult = NoteVectorRecord & { score: number };

export class RelatedNotesView extends ItemView {
  private service: RelatedNotesService | null = null;
  private currentFile: TFile | null = null;
  private renderToken = 0;

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
    this.updateView();
  }

  setCurrentFile(file: TFile | null) {
    this.currentFile = file?.extension === "md" ? file : null;
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

    const loading = this.renderState(container, {
      icon: "refresh-cw",
      title: "Loading related notes",
      description: "Searching the local semantic index...",
      loading: true,
    });

    const result = await this.service.getRelatedNotes(
      this.currentFile.path,
      this.plugin.settings.relatedNotesLimit
    );

    if (token !== this.renderToken) return;
    loading.remove();

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
    const titleWrap = header.createDiv({ cls: "related-notes-title-wrap" });
    const titleRow = titleWrap.createDiv({ cls: "related-notes-title-row" });
    const icon = titleRow.createSpan({ cls: "related-notes-title-icon" });
    setIcon(icon, "links-coming-in");
    titleRow.createEl("h4", { text: "Related Notes", cls: "related-notes-title" });

    titleWrap.createDiv({
      text: this.currentFile ? this.currentFile.basename : "No active note",
      cls: "related-notes-subtitle",
    });

    const toolbar = header.createDiv({ cls: "related-notes-toolbar" });
    this.addToolbarButton(toolbar, "refresh-cw", "Refresh results", () => this.updateView());
    this.addToolbarButton(toolbar, "scan-search", "Index current note", () => this.plugin.indexCurrentFile(this.currentFile));
    this.addToolbarButton(toolbar, "list-plus", "Index missing notes", () => this.plugin.indexMissingNotes());
    this.addToolbarButton(toolbar, "database-zap", "Reindex vault", () => this.plugin.reindexVault());
    this.addToolbarButton(toolbar, "settings", "Open settings", () => this.plugin.openSettings());
  }

  private renderResults(container: HTMLElement, notes: RelatedNoteResult[]) {
    const summary = container.createDiv({ cls: "related-notes-summary" });
    summary.createSpan({ text: `${notes.length} related note${notes.length === 1 ? "" : "s"}` });

    const list = container.createDiv({ cls: "related-notes-list" });

    for (const note of notes) {
      this.renderResultItem(list, note);
    }
  }

  private renderResultItem(list: HTMLElement, note: RelatedNoteResult) {
    const item = list.createDiv({ cls: "related-notes-item" });
    item.addClass(`is-score-${getScoreTone(note.score)}`);

    const main = item.createDiv({ cls: "related-notes-item-main" });
    const titleRow = main.createDiv({ cls: "related-notes-item-title-row" });
    const title = titleRow.createEl("a", { text: note.title, cls: "related-notes-link", href: "#" });
    title.onclick = (e) => {
      e.preventDefault();
      this.openNote(note.path, false);
    };

    titleRow.createSpan({ text: formatScore(note.score), cls: "related-notes-score" });

    if (note.folder) {
      main.createDiv({ text: note.folder, cls: "related-notes-path" });
    }

    if (note.preview) {
      main.createDiv({ text: note.preview, cls: "related-notes-preview" });
    }

    const actions = item.createDiv({ cls: "related-notes-item-actions" });
    this.addToolbarButton(actions, "file-input", "Open", () => this.openNote(note.path, false));
    this.addToolbarButton(actions, "columns-2", "Open in new pane", () => this.openNote(note.path, true));
    this.addToolbarButton(actions, "copy", "Copy wikilink", () => this.copyWikilink(note));
  }

  private renderState(
    container: HTMLElement,
    options: {
      icon: string;
      title: string;
      description: string;
      loading?: boolean;
      primaryAction?: { label: string; onClick: () => void | Promise<void> };
      secondaryAction?: { label: string; onClick: () => void | Promise<void> };
    }
  ): HTMLElement {
    const state = container.createDiv({ cls: "related-notes-state" });
    if (options.loading) state.addClass("is-loading");

    const icon = state.createDiv({ cls: "related-notes-state-icon" });
    setIcon(icon, options.icon);
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

  private addToolbarButton(parent: HTMLElement, iconName: string, tooltip: string, onClick: () => void | Promise<void>) {
    new ExtraButtonComponent(parent)
      .setIcon(iconName)
      .setTooltip(tooltip)
      .onClick(onClick);
  }

  private openNote(path: string, newPane: boolean) {
    this.app.workspace.openLinkText(path, "", newPane);
  }

  private async copyWikilink(note: RelatedNoteResult) {
    await navigator.clipboard.writeText(pathToWikilink(note.path, note.title));
    new Notice("Wikilink copied");
  }
}
