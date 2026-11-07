import React, { useState } from 'react';
import { STARTER_LANGUAGES } from '../../lib/starterCatalog';

export default function Step3Languages({ selectedLanguages, onToggleLanguage, customLanguage, onSetCustomLanguage }) {
  const [showOtherInput, setShowOtherInput] = useState(Boolean(customLanguage) || selectedLanguages.includes('Other'));

  const handleLanguageClick = (langId) => {
    if (langId === 'Other') {
      setShowOtherInput(!showOtherInput);
    }
    onToggleLanguage(langId);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="text-center max-w-xl mx-auto space-y-2">
        <span className="text-xs font-mono font-bold uppercase tracking-wider text-cyan-400 bg-cyan-400/10 px-3 py-1 rounded-full border border-cyan-400/20">
          Step 3 • Languages
        </span>
        <h2 className="text-2xl sm:text-3xl font-heading font-extrabold text-white tracking-tight">
          Which languages do you prefer for music?
        </h2>
        <p className="text-sm text-slate-400">
          Select one or more languages. We will tailor regional recommendations, trending charts, and lyrics.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[50vh] overflow-y-auto custom-scrollbar p-1">
        {STARTER_LANGUAGES.map((lang) => {
          const isSelected = selectedLanguages.includes(lang.id);
          return (
            <button
              type="button"
              key={lang.id}
              onClick={() => handleLanguageClick(lang.id)}
              className={`p-3.5 rounded-2xl border text-left transition-all duration-200 cursor-pointer flex items-center justify-between group ${
                isSelected
                  ? 'bg-gradient-to-r from-cyan-950/60 to-slate-900 border-cyan-400 shadow-lg shadow-cyan-950/40 scale-[1.02]'
                  : 'bg-white/[0.03] hover:bg-white/[0.06] border-white/[0.08] hover:border-white/[0.15]'
              }`}
            >
              <div>
                <h4 className="font-heading font-bold text-white text-sm">
                  {lang.name}
                </h4>
                <p className="text-[11px] font-medium text-slate-400 mt-0.5">
                  {lang.native}
                </p>
              </div>

              <div className={`w-5 h-5 rounded-full flex items-center justify-center border transition-all ${
                isSelected 
                  ? 'bg-cyan-400 border-cyan-400 text-black shadow-sm shadow-cyan-400/50' 
                  : 'border-white/20 bg-black/20'
              }`}>
                {isSelected && (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 stroke-[3]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Custom Other Language Input */}
      {(showOtherInput || selectedLanguages.includes('Other')) && (
        <div className="max-w-md mx-auto p-4 rounded-2xl bg-white/[0.03] border border-cyan-500/30 space-y-2 animate-fade-in">
          <label className="block text-xs font-semibold text-cyan-300">
            Specify Custom Language:
          </label>
          <input
            type="text"
            placeholder="e.g. Odia, Assamese, French, Turkish..."
            value={customLanguage}
            onChange={(e) => onSetCustomLanguage(e.target.value)}
            className="w-full px-3.5 py-2 rounded-xl bg-black/40 border border-white/[0.1] focus:border-cyan-400 text-white text-sm focus:outline-none"
          />
        </div>
      )}

      {selectedLanguages.length === 0 && (
        <p className="text-center text-xs text-amber-400/90 font-medium">
          Please select at least one language to continue.
        </p>
      )}
    </div>
  );
}
