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
import {
  EmbeddingProfileId,
  NoteVectorRecord,
  getEmbeddingProfileLabel,
} from "../types";
import { compareProfileResults, ComparedRelatedNote } from "./profileComparison";
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

    if (this.plugin.settings.sidebarProfileMode === "compare") {
      await this.renderCompareMode(container, token);
    } else {
      const profileId = this.plugin.settings.sidebarProfileMode === "single"
        ? this.plugin.settings.sidebarSelectedProfile
        : this.plugin.settings.defaultEmbeddingProfile;
      await this.renderSingleProfileMode(container, token, profileId);
    }
  }

  private renderHeader(container: HTMLElement) {
    const header = container.createDiv({ cls: "related-notes-header" });

    const top = header.createDiv({ cls: "related-notes-header-top" });
    const titleRow = top.createDiv({ cls: "related-notes-title-row" });
    const titleIcon = titleRow.createSpan({ cls: "related-notes-title-icon" });
    setIcon(titleIcon, "links-coming-in");
    titleRow.createEl("h4", { text: "Related Notes", cls: "related-notes-title" });

    const toolbar = top.createDiv({ cls: "related-notes-toolbar" });
    if (this.plugin.isIndexing()) {
      const tooltip = this.plugin.isIndexingStopRequested()
        ? "Stopping indexing"
        : "Stop indexing";
      const stopButton = this.addIconButton(toolbar, "square", tooltip, () => this.plugin.stopIndexing());
      stopButton.extraSettingsEl.addClass("related-notes-stop-indexing-button");
      if (this.plugin.isIndexingStopRequested()) {
        stopButton.extraSettingsEl.addClass("is-stopping");
        stopButton.extraSettingsEl.setAttr("aria-disabled", "true");
      }
    }
    this.addIconButton(toolbar, "refresh-cw", "Refresh results", () => this.updateView());
    this.addIconButton(toolbar, "more-horizontal", "More actions", (event) => this.openOverflowMenu(event));
    this.addIconButton(toolbar, "settings", "Open settings", () => this.plugin.openSettings());

    if (this.currentFile) {
      header.createDiv({ text: this.currentFile.basename, cls: "related-notes-subtitle" });
    }
  }

  private openOverflowMenu(event: MouseEvent | undefined) {
    const menu = new Menu();
    if (this.plugin.isIndexing()) {
      menu.addItem((item) =>
        item
          .setTitle(this.plugin.isIndexingStopRequested() ? "Stopping indexing" : "Stop indexing")
          .setIcon("square")
          .setDisabled(this.plugin.isIndexingStopRequested())
          .onClick(() => this.plugin.stopIndexing())
      );
      menu.addSeparator();
    }
	    menu.addItem((item) =>
	      item
	        .setTitle("Index current note")
	        .setIcon("scan-search")
	        .setDisabled(!this.currentFile)
	        .onClick(() => this.plugin.indexCurrentFile(this.currentFile, this.plugin.settings.defaultEmbeddingProfile))
	    );
    menu.addItem((item) =>
      item
        .setTitle("Index missing notes")
        .setIcon("list-plus")
        .onClick(() => this.plugin.indexMissingNotes())
    );
    menu.addItem((item) =>
      item
        .setTitle("Update index")
        .setIcon("refresh-cw")
        .onClick(async () => {
          await this.plugin.updateIndex();
        })
    );

    if (event) {
      menu.showAtMouseEvent(event);
    } else {
      menu.showAtPosition({ x: 0, y: 0 });
		}
  }

  private async renderSingleProfileMode(container: HTMLElement, token: number, profileId: EmbeddingProfileId) {
    if (!this.service || !this.currentFile) return;
    const skeleton = this.renderSkeleton(container);
    const result = await this.service.getRelatedNotes(
      this.currentFile.path,
      this.plugin.settings.relatedNotesLimit,
      profileId,
    );

    if (token !== this.renderToken) return;
    skeleton.remove();

    if (this.renderProfileResultState(container, result.status, profileId)) return;

    if (result.notes.length === 0) {
      this.renderState(container, {
        icon: "search-x",
        title: "No related notes found",
        description: `The current note is indexed for ${getEmbeddingProfileLabel(profileId)}, but no similar notes were found.`,
        primaryAction: { label: "Refresh", onClick: () => this.updateView() },
      });
      return;
    }

    this.renderResults(container, result.notes, getEmbeddingProfileLabel(profileId));
  }

  private async renderCompareMode(container: HTMLElement, token: number) {
    if (!this.service || !this.currentFile) return;
    const leftProfile = this.plugin.settings.sidebarCompareLeftProfile;
    const rightProfile = this.plugin.settings.sidebarCompareRightProfile;
    const skeleton = this.renderSkeleton(container);
    const [left, right] = await Promise.all([
      this.service.getRelatedNotes(this.currentFile.path, this.plugin.settings.relatedNotesLimit, leftProfile),
      this.service.getRelatedNotes(this.currentFile.path, this.plugin.settings.relatedNotesLimit, rightProfile),
    ]);

    if (token !== this.renderToken) return;
    skeleton.remove();

    const missingProfile = left.status === "not_indexed"
      ? leftProfile
      : right.status === "not_indexed"
        ? rightProfile
        : null;
    if (missingProfile) {
      this.renderState(container, {
        icon: "scan-search",
        title: `${getEmbeddingProfileLabel(missingProfile)} is not indexed yet`,
        description: "Index this note or missing notes for that profile before comparing.",
        primaryAction: {
          label: "Index this note",
          onClick: () => this.plugin.indexCurrentFile(this.currentFile, missingProfile),
        },
        secondaryAction: {
          label: "Index missing notes",
          onClick: async () => {
            await this.plugin.indexMissingNotes(missingProfile);
          },
        },
      });
      return;
    }

    if (left.status === "error" || right.status === "error") {
      this.renderState(container, {
        icon: "alert-triangle",
        title: "Could not compare profiles",
        description: "Try refreshing the panel or rebuilding the selected profile indexes.",
        primaryAction: { label: "Retry", onClick: () => this.updateView() },
      });
      return;
    }

    const comparison = compareProfileResults(left.notes, right.notes);
    const summary = container.createDiv({ cls: "related-notes-summary" });
    summary.setText(`${getEmbeddingProfileLabel(leftProfile)} vs ${getEmbeddingProfileLabel(rightProfile)}`);
    this.renderCompareSection(container, "Both profiles", comparison.both, leftProfile, rightProfile);
    this.renderResultsSection(container, `Only in ${getEmbeddingProfileLabel(leftProfile)}`, comparison.leftOnly);
    this.renderResultsSection(container, `Only in ${getEmbeddingProfileLabel(rightProfile)}`, comparison.rightOnly);
    this.renderCompareSection(container, "Rank changed", comparison.rankChanged, leftProfile, rightProfile);
  }

  private renderProfileResultState(
    container: HTMLElement,
    status: "ok" | "not_indexed" | "error",
    profileId: EmbeddingProfileId,
  ): boolean {
    if (status === "not_indexed") {
      this.renderState(container, {
        icon: "scan-search",
        title: `This note is not indexed for ${getEmbeddingProfileLabel(profileId)}`,
        description: "Index this note now, or index missing notes for this profile.",
        primaryAction: { label: "Index this note", onClick: () => this.plugin.indexCurrentFile(this.currentFile, profileId) },
        secondaryAction: {
          label: "Index missing notes",
          onClick: async () => {
            await this.plugin.indexMissingNotes(profileId);
          },
        },
      });
      return true;
    }

    if (status === "error") {
      this.renderState(container, {
        icon: "alert-triangle",
        title: "Could not load related notes",
        description: "Try refreshing the panel or updating the index.",
        primaryAction: { label: "Retry", onClick: () => this.updateView() },
        secondaryAction: {
          label: "Update index",
          onClick: async () => {
            await this.plugin.updateIndex(profileId);
          },
        },
      });
      return true;
    }

    return false;
  }

		  private renderResults(container: HTMLElement, notes: RelatedNoteResult[], profileLabel?: string) {
    const summary = container.createDiv({ cls: "related-notes-summary" });
    const countText = `${notes.length} note${notes.length === 1 ? "" : "s"}`;
    summary.setText(profileLabel ? `${countText} · ${profileLabel}` : countText);

    const list = container.createDiv({ cls: "related-notes-list" });
    for (const note of notes) {
      this.renderResultRow(list, note);
    }
  }
  private renderResultsSection(
    container: HTMLElement,
    title: string,
    notes: Array<{ path: string; title: string; score: number }>,
  ) {
    const section = container.createDiv({ cls: "related-notes-compare-section" });
    section.createDiv({ text: `${title} (${notes.length})`, cls: "related-notes-compare-heading" });
    if (notes.length === 0) {
      section.createDiv({ text: "No notes", cls: "related-notes-compare-empty" });
      return;
    }
    for (const note of notes) this.renderSimpleResultRow(section, note);
  }

  private renderCompareSection(
    container: HTMLElement,
    title: string,
    notes: ComparedRelatedNote[],
    leftProfile: EmbeddingProfileId,
    rightProfile: EmbeddingProfileId,
  ) {
    const section = container.createDiv({ cls: "related-notes-compare-section" });
    section.createDiv({ text: `${title} (${notes.length})`, cls: "related-notes-compare-heading" });
    if (notes.length === 0) {
      section.createDiv({ text: "No notes", cls: "related-notes-compare-empty" });
      return;
    }
    for (const note of notes) {
      const row = section.createDiv({ cls: "related-notes-compare-row" });
      row.setAttr("role", "button");
      row.setAttr("tabindex", "0");
      row.addEventListener("click", (event) => {
        const newPane = event.metaKey || event.ctrlKey;
        this.openNote(note.path, newPane);
      });
      const titleLine = row.createDiv({ cls: "related-notes-row-title-line" });
      titleLine.createDiv({ text: note.title, cls: "related-notes-row-title" });
      titleLine.createSpan({ text: formatScore(Math.max(note.leftScore, note.rightScore)), cls: "related-notes-score-text" });
      row.createDiv({
        text: `${getEmbeddingProfileLabel(leftProfile)} ${formatScore(note.leftScore)} · ${getEmbeddingProfileLabel(rightProfile)} ${formatScore(note.rightScore)} · Δ ${note.scoreDelta.toFixed(2)} · rank ${note.leftRank}→${note.rightRank}`,
        cls: "related-notes-row-meta",
      });
    }
  }

  private renderSimpleResultRow(
    list: HTMLElement,
    note: { path: string; title: string; score: number },
  ) {
    const row = list.createDiv({ cls: "related-notes-row" });
    row.addClass(`is-score-${getScoreTone(note.score)}`);
    row.setAttr("role", "button");
    row.setAttr("tabindex", "0");
    row.addEventListener("click", (event) => {
      const newPane = event.metaKey || event.ctrlKey;
      this.openNote(note.path, newPane);
    });
    const body = row.createDiv({ cls: "related-notes-row-body" });
    const titleLine = body.createDiv({ cls: "related-notes-row-title-line" });
    titleLine.createDiv({ text: note.title, cls: "related-notes-row-title" });
    titleLine.createSpan({ text: formatScore(note.score), cls: "related-notes-score-text" });
  }

  private renderResultRow(list: HTMLElement, note: RelatedNoteResult) {
    const row = list.createDiv({ cls: "related-notes-row" });
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
    const scoreEl = titleLine.createSpan({ text: formatScore(note.score), cls: "related-notes-score-text" });
    if (note.score >= 0.78) scoreEl.addClass("is-high-score");

    if (note.folder) {
      body.createDiv({ text: note.folder, cls: "related-notes-row-meta" });
    }

    if (note.preview) {
      let cleaned = note.preview.replace(/^#+\s*/, "").trim();
      const titleLower = note.title.toLowerCase();
      if (cleaned.toLowerCase().startsWith(titleLower)) {
        cleaned = cleaned.substring(note.title.length).trim();
      }
      if (cleaned) {
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

  private getProfileContextLabel(): string {
    const settings = this.plugin.settings;
    if (settings.sidebarProfileMode === "compare") {
      return `${getEmbeddingProfileLabel(settings.sidebarCompareLeftProfile)} vs ${getEmbeddingProfileLabel(settings.sidebarCompareRightProfile)}`;
    }
    if (settings.sidebarProfileMode === "single") {
      return getEmbeddingProfileLabel(settings.sidebarSelectedProfile);
    }
    return getEmbeddingProfileLabel(settings.defaultEmbeddingProfile);
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
