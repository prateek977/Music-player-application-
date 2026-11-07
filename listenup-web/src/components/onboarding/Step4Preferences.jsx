import React from 'react';
import { LISTENING_MOODS, LISTENING_ACTIVITIES } from '../../lib/starterCatalog';

export default function Step4Preferences({
  selectedMoods,
  onToggleMood,
  selectedActivities,
  onToggleActivity,
  explicitPreference,
  onToggleExplicit
}) {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="text-center max-w-xl mx-auto space-y-2">
        <span className="text-xs font-mono font-bold uppercase tracking-wider text-cyan-400 bg-cyan-400/10 px-3 py-1 rounded-full border border-cyan-400/20">
          Step 4 • Listening Vibe (Optional)
        </span>
        <h2 className="text-2xl sm:text-3xl font-heading font-extrabold text-white tracking-tight">
          How & when do you listen?
        </h2>
        <p className="text-sm text-slate-400">
          Help us schedule smart mixes throughout your day. You can skip any of these questions.
        </p>
      </div>

      <div className="space-y-6 max-h-[55vh] overflow-y-auto custom-scrollbar p-1 max-w-2xl mx-auto">
        {/* Mood Selection */}
        <div className="space-y-3">
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-300">
            Preferred Listening Moods
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {LISTENING_MOODS.map((mood) => {
              const isSelected = selectedMoods.includes(mood.id);
              return (
                <button
                  type="button"
                  key={mood.id}
                  onClick={() => onToggleMood(mood.id)}
                  className={`p-3 rounded-xl border text-left transition-all duration-200 cursor-pointer flex items-center gap-2.5 ${
                    isSelected
                      ? 'bg-cyan-500/15 border-cyan-400 text-white shadow-md shadow-cyan-950/40'
                      : 'bg-white/[0.03] hover:bg-white/[0.06] border-white/[0.08] text-slate-300 hover:text-white'
                  }`}
                >
                  <span className="text-xl">{mood.icon}</span>
                  <div>
                    <h5 className="text-xs font-bold">{mood.label}</h5>
                    <p className="text-[10px] text-slate-400 line-clamp-1">{mood.desc}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Activity Selection */}
        <div className="space-y-3">
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-300">
            Primary Listening Activities
          </label>
          <div className="flex flex-wrap gap-2">
            {LISTENING_ACTIVITIES.map((act) => {
              const isSelected = selectedActivities.includes(act.id);
              return (
                <button
                  type="button"
                  key={act.id}
                  onClick={() => onToggleActivity(act.id)}
                  className={`px-4 py-2 rounded-full border text-xs font-semibold transition-all duration-200 cursor-pointer flex items-center gap-2 ${
                    isSelected
                      ? 'bg-cyan-400 text-black border-cyan-400 shadow-md shadow-cyan-400/20'
                      : 'bg-white/[0.03] hover:bg-white/[0.08] border-white/[0.08] text-slate-300 hover:text-white'
                  }`}
                >
                  <span>{act.icon}</span>
                  <span>{act.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Explicit Content Toggle */}
        <div className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.03] border border-white/[0.08]">
          <div className="space-y-0.5">
            <h5 className="text-xs font-bold text-white flex items-center gap-2">
              <span>Allow Explicit Audio Tracks</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/[0.1] text-slate-300">E</span>
            </h5>
            <p className="text-[11px] text-slate-400">
              Include uncensored official versions in search and recommendations.
            </p>
          </div>
          <button
            type="button"
            onClick={onToggleExplicit}
            className={`w-12 h-6 rounded-full transition-colors relative cursor-pointer ${
              explicitPreference ? 'bg-cyan-400' : 'bg-slate-700'
            }`}
          >
            <div className={`w-5 h-5 rounded-full bg-black absolute top-0.5 transition-transform ${
              explicitPreference ? 'translate-x-6 bg-black' : 'translate-x-0.5 bg-slate-300'
            }`} />
          </button>
        </div>
      </div>
    </div>
  );
}
