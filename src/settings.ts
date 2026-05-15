import { App, PluginSettingTab, Setting } from "obsidian";
import RelatedNotesPlugin from "./main";

export class RelatedNotesSettingTab extends PluginSettingTab {
  plugin: RelatedNotesPlugin;

  constructor(app: App, plugin: RelatedNotesPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Related Notes Settings" });

    new Setting(containerEl)
      .setName("Gemini API Key")
      .setDesc("Enter your Google Gemini API key.")
      .addText((text) =>
        text
          .setPlaceholder("Enter key...")
          .setValue(this.plugin.settings.geminiApiKey)
          .onChange(async (value) => {
            this.plugin.settings.geminiApiKey = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Related Notes Limit")
      .setDesc("Number of related notes to show in the sidebar.")
      .addSlider((slider) =>
        slider
          .setLimits(1, 20, 1)
          .setValue(this.plugin.settings.relatedNotesLimit)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.relatedNotesLimit = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Gemini request delay")
      .setDesc("Optional pause between embedding requests. Keep at 0 unless Gemini returns rate-limit errors.")
      .addSlider((slider) =>
        slider
          .setLimits(0, 5000, 250)
          .setValue(this.plugin.settings.embeddingRequestDelayMs)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.embeddingRequestDelayMs = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "Indexing" });

    new Setting(containerEl)
      .setName("Index Missing Notes")
      .setDesc("Only embed Markdown notes that are not already present in the local index.")
      .addButton((btn) =>
        btn.setButtonText("Index Missing").onClick(async () => {
          await this.plugin.indexMissingNotes();
        })
      );

    new Setting(containerEl)
      .setName("Reindex Vault")
      .setDesc("Scan all notes and update the semantic index.")
      .addButton((btn) =>
        btn.setButtonText("Reindex Now").onClick(async () => {
          await this.plugin.reindexVault();
        })
      );

    new Setting(containerEl)
      .setName("Clear Index")
      .setDesc("Remove all local semantic data.")
      .addButton((btn) =>
        btn
          .setButtonText("Clear Index")
          .setWarning()
          .onClick(async () => {
            await this.plugin.store.clear();
          })
      );
  }
}
