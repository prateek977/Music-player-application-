import React, { useState, useEffect } from 'react';
import { useAuth } from '../../lib/authContext';
import Step1Genres from './Step1Genres';
import Step2Artists from './Step2Artists';
import Step3Languages from './Step3Languages';
import Step4Preferences from './Step4Preferences';
import Step5Review from './Step5Review';

const STEP_TITLES = [
  { num: 1, label: 'Genres' },
  { num: 2, label: 'Artists' },
  { num: 3, label: 'Languages' },
  { num: 4, label: 'Vibes' },
  { num: 5, label: 'Review' }
];

export default function OnboardingFlow({ onComplete }) {
  const { user, saveOnboardingData, skipOnboarding } = useAuth();

  // Load draft from localStorage if available using lazy initializer (prevents mount thrashing)
  const initialDraft = (() => {
    try {
      const draft = localStorage.getItem('listenup_onboarding_draft');
      return draft ? JSON.parse(draft) : null;
    } catch {
      return null;
    }
  })();

  const [step, setStep] = useState(initialDraft?.step || 1);
  const [selectedGenres, setSelectedGenres] = useState(initialDraft?.selectedGenres || []);
  const [selectedArtists, setSelectedArtists] = useState(initialDraft?.selectedArtists || []);
  const [selectedLanguages, setSelectedLanguages] = useState(initialDraft?.selectedLanguages || []);
  const [customLanguage, setCustomLanguage] = useState(initialDraft?.customLanguage || '');
  const [selectedMoods, setSelectedMoods] = useState(initialDraft?.selectedMoods || []);
  const [selectedActivities, setSelectedActivities] = useState(initialDraft?.selectedActivities || []);
  const [explicitPreference, setExplicitPreference] = useState(
    initialDraft?.explicitPreference !== undefined ? initialDraft.explicitPreference : true
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSkipToApp = async () => {
    localStorage.removeItem('listenup_onboarding_draft');
    if (user) {
      localStorage.setItem(`listenup_onboarding_completed_${user.id}`, 'true');
      localStorage.removeItem(`listenup_needs_onboarding_${user.id}`);
    }
    sessionStorage.removeItem('listenup_just_signed_up');
    if (skipOnboarding) {
      await skipOnboarding();
    }
    if (onComplete) {
      onComplete();
    }
  };

  // Persist draft on user choice changes
  useEffect(() => {
    try {
      localStorage.setItem('listenup_onboarding_draft', JSON.stringify({
        step,
        selectedGenres,
        selectedArtists,
        selectedLanguages,
        customLanguage,
        selectedMoods,
        selectedActivities,
        explicitPreference
      }));
    } catch (e) {
      console.warn('Could not save draft:', e);
    }
  }, [step, selectedGenres, selectedArtists, selectedLanguages, customLanguage, selectedMoods, selectedActivities, explicitPreference]);

  // Toggle Handlers
  const handleToggleGenre = (id) => {
    setSelectedGenres(prev => 
      prev.includes(id) ? prev.filter(g => g !== id) : [...prev, id]
    );
  };

  const handleToggleArtist = (artist) => {
    const artistKey = artist.name;
    setSelectedArtists(prev => {
      const exists = prev.some(a => (typeof a === 'string' ? a : a.name) === artistKey);
      if (exists) {
        return prev.filter(a => (typeof a === 'string' ? a : a.name) !== artistKey);
      }
      return [...prev, artist];
    });
  };

  const handleAddCustomArtist = (artistObj) => {
    setSelectedArtists(prev => {
      if (prev.some(a => (typeof a === 'string' ? a : a.name) === artistObj.name)) return prev;
      return [...prev, artistObj];
    });
  };

  const handleToggleLanguage = (id) => {
    setSelectedLanguages(prev => 
      prev.includes(id) ? prev.filter(l => l !== id) : [...prev, id]
    );
  };

  const handleToggleMood = (id) => {
    setSelectedMoods(prev => 
      prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]
    );
  };

  const handleToggleActivity = (id) => {
    setSelectedActivities(prev => 
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    );
  };

  // Step Validation Check
  const canProceed = () => {
    if (step === 1) return selectedGenres.length >= 1;
    if (step === 2) return selectedArtists.length >= 3;
    if (step === 3) return selectedLanguages.length >= 1;
    if (step === 4) return true; // optional
    return true;
  };

  const handleContinue = () => {
    setError('');
    if (!canProceed()) {
      if (step === 1) setError('Please select at least 1 music genre.');
      if (step === 2) setError('Please select at least 3 favourite artists.');
      if (step === 3) setError('Please select at least 1 language.');
      return;
    }
    setStep(prev => Math.min(prev + 1, 5));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleBack = () => {
    setError('');
    setStep(prev => Math.max(prev - 1, 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Final Complete Handler
  const handleSavePreferences = async () => {
    if (selectedGenres.length < 1) {
      setError('Please select at least 1 music genre.');
      setStep(1);
      return;
    }
    if (selectedArtists.length < 3) {
      setError('Please select at least 3 favourite artists.');
      setStep(2);
      return;
    }
    if (selectedLanguages.length < 1) {
      setError('Please select at least 1 language.');
      setStep(3);
      return;
    }

    setSaving(true);
    setError('');

    const res = await saveOnboardingData({
      genres: selectedGenres,
      artists: selectedArtists,
      languages: selectedLanguages,
      customLanguage,
      moods: selectedMoods,
      activities: selectedActivities,
      explicitContent: explicitPreference
    });

    setSaving(false);

    if (res.success) {
      if (user) {
        localStorage.setItem(`listenup_onboarding_completed_${user.id}`, 'true');
        localStorage.removeItem(`listenup_needs_onboarding_${user.id}`);
      }
      localStorage.removeItem('listenup_onboarding_draft');
      sessionStorage.removeItem('listenup_just_signed_up');
      if (onComplete) {
        onComplete();
      }
    } else {
      setError(res.error || 'Failed to save your preferences. Please try again.');
    }
  };

  const progressPercent = (step / 5) * 100;

  return (
    <div className="min-h-screen bg-[#090d13] text-white flex flex-col justify-between p-4 sm:p-6 md:p-8">
      {/* Top Header & Brand */}
      <div className="max-w-4xl mx-auto w-full pt-2 pb-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-cyan-400 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/25">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-black">
                <path fillRule="evenodd" d="M19.952 1.651a.75.75 0 0 1 .298.599V16.303a3 3 0 0 1-2.176 2.884l-1.32.377a2.553 2.553 0 1 1-1.403-4.909l2.311-.66a1.5 1.5 0 0 0 1.088-1.442V6.994l-9 2.572v9.737a3 3 0 0 1-2.176 2.884l-1.32.377a2.553 2.553 0 1 1-1.402-4.909l2.31-.66a1.5 1.5 0 0 0 1.088-1.442V5.25a.75.75 0 0 1 .544-.721l10.5-3a.75.75 0 0 1 .667.122Z" clipRule="evenodd" />
              </svg>
            </div>
            <div>
              <h1 className="font-heading font-extrabold text-lg text-white tracking-tight">
                ListenUp
              </h1>
              <p className="text-[11px] font-mono text-cyan-400">
                Taste Onboarding
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSkipToApp}
              className="px-3.5 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-xs font-semibold text-slate-300 hover:text-cyan-400 transition-all flex items-center gap-1.5 cursor-pointer"
              title="Skip onboarding and start listening"
            >
              <span>Skip to ListenUp</span>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
            <span className="text-xs font-mono text-slate-400 hidden sm:inline">
              Step <strong className="text-cyan-400">{step}</strong> of 5
            </span>
          </div>
        </div>

        {/* Multi-Step Stepper Bar */}
        <div className="space-y-2">
          <div className="w-full h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-cyan-400 to-blue-500 rounded-full transition-all duration-300 shadow-sm shadow-cyan-400/50"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <div className="flex justify-between items-center px-1">
            {STEP_TITLES.map((s) => (
              <button
                key={s.num}
                type="button"
                onClick={() => {
                  if (s.num < step) setStep(s.num);
                }}
                disabled={s.num > step}
                className={`text-[11px] font-semibold transition-colors cursor-pointer ${
                  s.num === step
                    ? 'text-cyan-400 font-bold'
                    : s.num < step
                    ? 'text-slate-300 hover:text-white'
                    : 'text-slate-600 cursor-not-allowed'
                }`}
              >
                {s.num}. {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Step Content */}
      <div className="max-w-4xl mx-auto w-full flex-1 flex flex-col justify-center my-4">
        {step === 1 && (
          <Step1Genres
            selectedGenres={selectedGenres}
            onToggleGenre={handleToggleGenre}
          />
        )}

        {step === 2 && (
          <Step2Artists
            selectedArtists={selectedArtists}
            onToggleArtist={handleToggleArtist}
            onAddCustomArtist={handleAddCustomArtist}
          />
        )}

        {step === 3 && (
          <Step3Languages
            selectedLanguages={selectedLanguages}
            onToggleLanguage={handleToggleLanguage}
            customLanguage={customLanguage}
            onSetCustomLanguage={setCustomLanguage}
          />
        )}

        {step === 4 && (
          <Step4Preferences
            selectedMoods={selectedMoods}
            onToggleMood={handleToggleMood}
            selectedActivities={selectedActivities}
            onToggleActivity={handleToggleActivity}
            explicitPreference={explicitPreference}
            onToggleExplicit={() => setExplicitPreference(!explicitPreference)}
          />
        )}

        {step === 5 && (
          <Step5Review
            selectedGenres={selectedGenres}
            selectedArtists={selectedArtists}
            selectedLanguages={selectedLanguages}
            customLanguage={customLanguage}
            selectedMoods={selectedMoods}
            selectedActivities={selectedActivities}
            explicitPreference={explicitPreference}
            onGoToStep={setStep}
            onSave={handleSavePreferences}
            saving={saving}
            error={error}
          />
        )}

        {error && step !== 5 && (
          <div className="mt-4 p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs text-center max-w-md mx-auto">
            {error}
          </div>
        )}
      </div>

      {/* Bottom Sticky Action Footer */}
      {step !== 5 && (
        <div className="max-w-4xl mx-auto w-full pt-4 pb-2 border-t border-white/[0.08] flex items-center justify-between">
          {step > 1 ? (
            <button
              type="button"
              onClick={handleBack}
              className="px-5 py-2.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 hover:text-white text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span>Back</span>
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-3">
            {step === 4 && (
              <button
                type="button"
                onClick={() => setStep(5)}
                className="px-4 py-2.5 text-xs text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                Skip this step
              </button>
            )}

            <button
              type="button"
              onClick={handleContinue}
              disabled={!canProceed()}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-400 to-cyan-500 hover:from-cyan-300 hover:to-cyan-400 text-black font-extrabold text-xs tracking-wide shadow-lg shadow-cyan-500/20 transition-all transform active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 cursor-pointer"
            >
              <span>Continue</span>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
