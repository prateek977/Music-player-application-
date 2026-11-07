import React, { useState } from 'react';

export default function GuestMigrationModal({
  isOpen,
  guestFavoritesCount,
  guestPlaylistsCount,
  onConfirmMerge,
  onSkip
}) {
  const [merging, setMerging] = useState(false);

  if (!isOpen || (guestFavoritesCount === 0 && guestPlaylistsCount === 0)) return null;

  const handleMerge = async () => {
    setMerging(true);
    await onConfirmMerge();
    setMerging(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div 
        className="relative w-full max-w-md p-6 rounded-3xl bg-[#0f141c] border border-cyan-500/30 shadow-2xl shadow-cyan-950/50 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-12 h-12 rounded-2xl bg-cyan-500/15 border border-cyan-400/30 text-cyan-400 flex items-center justify-center mx-auto mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
        </div>

        <h3 className="font-heading text-lg font-bold text-center text-white">
          Sync Guest Music to Your Account?
        </h3>

        <p className="text-xs text-slate-400 text-center mt-2 leading-relaxed">
          We found <strong>{guestFavoritesCount} favorite song{guestFavoritesCount !== 1 ? 's' : ''}</strong> and <strong>{guestPlaylistsCount} custom playlist{guestPlaylistsCount !== 1 ? 's' : ''}</strong> from your guest listening session. Would you like to merge them safely into your cloud account?
        </p>

        <div className="mt-6 flex flex-col gap-2.5">
          <button
            type="button"
            onClick={handleMerge}
            disabled={merging}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-cyan-400 to-cyan-500 hover:from-cyan-300 hover:to-cyan-400 text-black font-extrabold text-xs shadow-md shadow-cyan-500/20 transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            {merging ? (
              <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
            ) : (
              <span>Yes, Sync to My Cloud Account</span>
            )}
          </button>

          <button
            type="button"
            onClick={onSkip}
            className="w-full py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            Keep Local Only
          </button>
        </div>
      </div>
    </div>
  );
}
