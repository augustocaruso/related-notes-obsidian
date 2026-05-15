import { App, PluginSettingTab, Setting } from "obsidian";
import RelatedNotesPlugin from "./main";
import {
  EmbeddingProfileId,
  USER_SELECTABLE_EMBEDDING_PROFILES,
  getEmbeddingProfileLabel,
  normalizeRelatedNotesSettings,
} from "./types";

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
	      .setName("Default embedding profile")
	      .setDesc("Normal indexing, related-note lookup, and Workbench export use this profile.")
	      .addDropdown((dropdown) => {
	        for (const profileId of USER_SELECTABLE_EMBEDDING_PROFILES) {
	          dropdown.addOption(profileId, getEmbeddingProfileLabel(profileId));
	        }
	        dropdown
	          .setValue(this.plugin.settings.defaultEmbeddingProfile)
	          .onChange(async (value) => {
	            this.plugin.settings.defaultEmbeddingProfile = value as EmbeddingProfileId;
	            this.plugin.settings = normalizeRelatedNotesSettings(this.plugin.settings);
	            await this.plugin.saveSettings();
	            this.display();
	          });
	      });

	    new Setting(containerEl)
	      .setName("Store Clean v1")
	      .setDesc("Clean v1 is the recommended profile and is always stored when it is the default.")
	      .addToggle((toggle) =>
	        toggle
	          .setValue(this.plugin.settings.storedEmbeddingProfiles.includes("clean_v1"))
	          .setDisabled(this.plugin.settings.defaultEmbeddingProfile === "clean_v1")
	          .onChange(async (value) => {
	            this.setStoredProfile("clean_v1", value);
	            await this.plugin.saveSettings();
	            this.display();
	          })
	      );

	    new Setting(containerEl)
	      .setName("Store Raw v1")
	      .setDesc("Raw v1 is only indexed when you explicitly request it.")
	      .addToggle((toggle) =>
	        toggle
	          .setValue(this.plugin.settings.storedEmbeddingProfiles.includes("raw_v1"))
	          .setDisabled(this.plugin.settings.defaultEmbeddingProfile === "raw_v1")
	          .onChange(async (value) => {
	            this.setStoredProfile("raw_v1", value);
	            await this.plugin.saveSettings();
	            this.display();
	          })
	      );

	    containerEl.createEl("h3", { text: "Sidebar" });

	    new Setting(containerEl)
	      .setName("Sidebar profile mode")
	      .setDesc("Choose whether the sidebar follows the default profile, a single stored profile, or compares two profiles.")
	      .addDropdown((dropdown) =>
	        dropdown
	          .addOption("default", "Default profile")
	          .addOption("single", "Single stored profile")
	          .addOption("compare", "Compare two profiles")
	          .setValue(this.plugin.settings.sidebarProfileMode)
	          .onChange(async (value) => {
	            this.plugin.settings.sidebarProfileMode = value as any;
	            this.plugin.settings = normalizeRelatedNotesSettings(this.plugin.settings);
	            await this.plugin.saveSettings();
	            this.display();
	          })
	      );

	    new Setting(containerEl)
	      .setName("Single profile")
	      .setDesc("Used when sidebar mode is set to single profile.")
	      .addDropdown((dropdown) => {
	        this.addStoredProfileOptions(dropdown);
	        dropdown
	          .setValue(this.plugin.settings.sidebarSelectedProfile)
	          .onChange(async (value) => {
	            this.plugin.settings.sidebarSelectedProfile = value as EmbeddingProfileId;
	            this.plugin.settings = normalizeRelatedNotesSettings(this.plugin.settings);
	            await this.plugin.saveSettings();
	          });
	      });

	    new Setting(containerEl)
	      .setName("Compare profiles")
	      .setDesc("Used when sidebar mode is set to compare two profiles.")
	      .addDropdown((dropdown) => {
	        this.addStoredProfileOptions(dropdown);
	        dropdown
	          .setValue(this.plugin.settings.sidebarCompareLeftProfile)
	          .onChange(async (value) => {
	            this.plugin.settings.sidebarCompareLeftProfile = value as EmbeddingProfileId;
	            this.plugin.settings = normalizeRelatedNotesSettings(this.plugin.settings);
	            await this.plugin.saveSettings();
	          });
	      })
	      .addDropdown((dropdown) => {
	        this.addStoredProfileOptions(dropdown);
	        dropdown
	          .setValue(this.plugin.settings.sidebarCompareRightProfile)
	          .onChange(async (value) => {
	            this.plugin.settings.sidebarCompareRightProfile = value as EmbeddingProfileId;
	            this.plugin.settings = normalizeRelatedNotesSettings(this.plugin.settings);
	            await this.plugin.saveSettings();
	          });
	      });

	    new Setting(containerEl)
	      .setName("Index missing notes")
	      .setDesc("Only embed Markdown notes that are not already present in the default profile.")
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
	      .setName("Index all stored profiles")
	      .setDesc("Runs missing-note indexing for every stored profile, including Raw v1 if enabled.")
	      .addButton((btn) =>
	        btn.setButtonText("Index Stored Profiles").onClick(async () => {
	          await this.plugin.indexAllStoredProfiles();
	        })
	      );

	    new Setting(containerEl)
	      .setName("Clear default profile index")
	      .setDesc("Remove local semantic data for the default profile only.")
	      .addButton((btn) =>
	        btn
	          .setButtonText("Clear Default")
	          .setWarning()
	          .onClick(async () => {
	            await this.plugin.clearDefaultProfileIndex();
	          })
	      );

	    new Setting(containerEl)
	      .setName("Clear all profile indexes")
	      .setDesc("Remove all local semantic data, including comparison profiles.")
	      .addButton((btn) =>
	        btn
	          .setButtonText("Clear All")
	          .setWarning()
	          .onClick(async () => {
	            await this.plugin.clearAllProfileIndexes();
	          })
	      );
	  }

	  private setStoredProfile(profileId: EmbeddingProfileId, enabled: boolean) {
	    const set = new Set(this.plugin.settings.storedEmbeddingProfiles);
	    if (enabled) {
	      set.add(profileId);
	    } else {
	      set.delete(profileId);
	    }
	    this.plugin.settings.storedEmbeddingProfiles = [...set];
	    this.plugin.settings = normalizeRelatedNotesSettings(this.plugin.settings);
	  }

	  private addStoredProfileOptions(dropdown: { addOption(value: string, display: string): unknown }) {
	    for (const profileId of this.plugin.settings.storedEmbeddingProfiles) {
	      dropdown.addOption(profileId, getEmbeddingProfileLabel(profileId));
	    }
	  }
	}
