import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  Download,
  FileCode2,
  HelpCircle,
  Info,
  Lock,
  Play,
  RotateCcw,
  Settings,
  Smartphone,
  Trophy,
  Type,
  XCircle,
} from 'lucide-react';
import {
  ChapterProgress,
  findPageIndexForOffset,
  getOffsetForPage,
  paginateChapterText,
  READER_THEMES,
  ReaderThemeId,
  SHERLOCK_BOOK,
  SHERLOCK_CHAPTERS,
} from './data/sherlockData';
import { useOnlineStatus, usePWAInstall } from './hooks/usePWAInstall';
import {
  downloadAndroidProjectZip,
  getAndroidProjectFiles,
} from './utils/androidProjectBuilder';

type ActiveSection = 'library' | 'reader' | 'quiz' | 'apk';

const STORAGE_KEY_PROGRESS = 'interactive_reader_room_progress_v1';
const STORAGE_KEY_SETTINGS = 'interactive_reader_datastore_settings_v1';
const PASSING_SCORE_PERCENT = 75;

interface StoredSettings {
  fontSizeSp: number;
  theme: ReaderThemeId;
}

function getInitialProgress(): Record<number, ChapterProgress> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PROGRESS);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    // ignore storage errors
  }
  const now = Date.now();
  return {
    1: {
      bookId: 1,
      chapterId: 1,
      status: 'AVAILABLE',
      lastCharOffset: 0,
      bestQuizScore: 0,
      updatedAt: now,
    },
    2: {
      bookId: 1,
      chapterId: 2,
      status: 'LOCKED',
      lastCharOffset: 0,
      bestQuizScore: 0,
      updatedAt: now,
    },
  };
}

function getInitialSettings(): StoredSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        fontSizeSp: Math.min(28, Math.max(14, Number(parsed.fontSizeSp) || 18)),
        theme: parsed.theme in READER_THEMES ? parsed.theme : 'LIGHT',
      };
    }
  } catch {
    // ignore
  }
  return {
    fontSizeSp: 18,
    theme: 'LIGHT',
  };
}

export default function App() {
  const [activeSection, setActiveSection] = useState<ActiveSection>('library');
  const [activeChapterId, setActiveChapterId] = useState<number>(1);
  const [progressMap, setProgressMap] = useState<Record<number, ChapterProgress>>(getInitialProgress);
  const [settings, setSettings] = useState<StoredSettings>(getInitialSettings);

  // Reader MVI State
  const [isControlsVisible, setIsControlsVisible] = useState<boolean>(true);
  const [isSettingsSheetOpen, setIsSettingsSheetOpen] = useState<boolean>(false);
  const [currentPageIndex, setCurrentPageIndex] = useState<number>(0);
  const [anchorCharOffset, setAnchorCharOffset] = useState<number>(0);
  const [readerBoxSize, setReaderBoxSize] = useState<{ width: number; height: number }>({
    width: 360,
    height: 460,
  });
  const readerContainerRef = useRef<HTMLDivElement | null>(null);

  // Quiz MVI State
  const [quizQuestionIndex, setQuizQuestionIndex] = useState<number>(0);
  const [selectedOptionIndex, setSelectedOptionIndex] = useState<number | null>(null);
  const [isAnswerSubmitted, setIsAnswerSubmitted] = useState<boolean>(false);
  const [correctAnswersCount, setCorrectAnswersCount] = useState<number>(0);
  const [isQuizCompleted, setIsQuizCompleted] = useState<boolean>(false);

  // APK Builder & Install Modal State
  const [isDownloadingZip, setIsDownloadingZip] = useState<boolean>(false);
  const [selectedSourceIndex, setSelectedSourceIndex] = useState<number>(0);
  const [copiedFile, setCopiedFile] = useState<boolean>(false);
  const [showInstallModal, setShowInstallModal] = useState<boolean>(false);

  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const isOnline = useOnlineStatus();
  const projectFiles = useMemo(() => getAndroidProjectFiles(), []);

  // Persist Progress & Settings
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_PROGRESS, JSON.stringify(progressMap));
    } catch {
      // ignore
    }
  }, [progressMap]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
    } catch {
      // ignore
    }
  }, [settings]);

  // Observe reader viewport dimensions (BoxWithConstraints equivalent)
  useEffect(() => {
    const el = readerContainerRef.current;
    if (!el) return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 100 && rect.height > 150) {
        setReaderBoxSize({
          width: Math.floor(rect.width - 48),
          height: Math.floor(rect.height - 104),
        });
      }
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, [activeSection]);

  const currentChapter = useMemo(
    () => SHERLOCK_CHAPTERS.find((c) => c.id === activeChapterId) || SHERLOCK_CHAPTERS[0],
    [activeChapterId]
  );

  // Paginate chapter text on constraints or fontSize change and restore page index from anchorCharOffset
  const pages = useMemo(() => {
    return paginateChapterText(
      currentChapter.id,
      currentChapter.content,
      readerBoxSize.width,
      readerBoxSize.height,
      settings.fontSizeSp
    );
  }, [currentChapter.id, currentChapter.content, readerBoxSize.width, readerBoxSize.height, settings.fontSizeSp]);

  useEffect(() => {
    const restoredIndex = findPageIndexForOffset(pages, anchorCharOffset);
    setCurrentPageIndex(restoredIndex);
  }, [pages]);

  // Debounced (300ms) save of lastCharOffset to Room Progress equivalent
  useEffect(() => {
    if (activeSection !== 'reader') return;
    const timer = window.setTimeout(() => {
      setProgressMap((prev) => {
        const existing = prev[activeChapterId];
        if (!existing || existing.lastCharOffset === anchorCharOffset) return prev;
        return {
          ...prev,
          [activeChapterId]: {
            ...existing,
            lastCharOffset: anchorCharOffset,
            updatedAt: Date.now(),
          },
        };
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [anchorCharOffset, activeChapterId, activeSection]);

  // Book completion calculation (GetBookDetailsWithProgressUseCase)
  const bookStats = useMemo(() => {
    const total = SHERLOCK_CHAPTERS.length;
    const completed = SHERLOCK_CHAPTERS.filter(
      (ch) => progressMap[ch.id]?.status === 'PASSED'
    ).length;
    const ratio = total > 0 ? completed / total : 0;
    return { total, completed, ratio };
  }, [progressMap]);

  // Open a chapter in Reader
  const handleOpenChapter = (chapterId: number) => {
    const chProgress = progressMap[chapterId];
    if (chProgress?.status === 'LOCKED') return;
    const savedOffset = chProgress?.lastCharOffset || 0;
    setActiveChapterId(chapterId);
    setAnchorCharOffset(savedOffset);
    setIsSettingsSheetOpen(false);
    setActiveSection('reader');
  };

  // Page turn handler
  const handlePageTurn = (targetIndex: number) => {
    if (pages.length === 0) return;
    const clamped = Math.min(Math.max(0, targetIndex), pages.length - 1);
    setCurrentPageIndex(clamped);
    const newOffset = getOffsetForPage(pages, clamped);
    setAnchorCharOffset(newOffset);
  };

  // Reader click-zoning: left 25% prev, right 25% next, center 50% toggle controls
  const handleReaderSurfaceClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isSettingsSheetOpen) {
      setIsSettingsSheetOpen(false);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;

    if (clickX < width * 0.25) {
      if (currentPageIndex > 0) {
        handlePageTurn(currentPageIndex - 1);
      }
    } else if (clickX > width * 0.75) {
      if (currentPageIndex < pages.length - 1) {
        handlePageTurn(currentPageIndex + 1);
      }
    } else {
      setIsControlsVisible((prev) => !prev);
    }
  };

  // Start Quiz for current chapter
  const handleStartQuiz = (chapterId: number = activeChapterId) => {
    setActiveChapterId(chapterId);
    setQuizQuestionIndex(0);
    setSelectedOptionIndex(null);
    setIsAnswerSubmitted(false);
    setCorrectAnswersCount(0);
    setIsQuizCompleted(false);
    setActiveSection('quiz');
  };

  const handleSubmitQuizAnswer = () => {
    if (selectedOptionIndex === null || isAnswerSubmitted) return;
    const question = currentChapter.questions[quizQuestionIndex];
    if (!question) return;

    const isCorrect = selectedOptionIndex === question.correctOptionIndex;
    const updatedCorrect = isCorrect ? correctAnswersCount + 1 : correctAnswersCount;
    setCorrectAnswersCount(updatedCorrect);
    setIsAnswerSubmitted(true);
  };

  const handleNextQuizQuestion = () => {
    if (!isAnswerSubmitted) return;
    const totalQ = currentChapter.questions.length;

    if (quizQuestionIndex + 1 < totalQ) {
      setQuizQuestionIndex((prev) => prev + 1);
      setSelectedOptionIndex(null);
      setIsAnswerSubmitted(false);
    } else {
      // Complete quiz & run CompleteChapterAndUnlockNextUseCase if score >= 75%
      const finalScore = Math.round((correctAnswersCount / totalQ) * 100);
      const isPassed = finalScore >= PASSING_SCORE_PERCENT;

      if (isPassed) {
        const now = Date.now();
        const nextChapter = SHERLOCK_CHAPTERS.find(
          (c) => c.chapterIndex === currentChapter.chapterIndex + 1
        );

        setProgressMap((prev) => {
          const currentProg = prev[currentChapter.id] || {
            bookId: 1,
            chapterId: currentChapter.id,
            status: 'AVAILABLE',
            lastCharOffset: 0,
            bestQuizScore: 0,
            updatedAt: now,
          };

          const updated: Record<number, ChapterProgress> = {
            ...prev,
            [currentChapter.id]: {
              ...currentProg,
              status: 'PASSED',
              bestQuizScore: Math.max(currentProg.bestQuizScore, finalScore),
              updatedAt: now,
            },
          };

          if (nextChapter) {
            const nextProg = prev[nextChapter.id];
            if (!nextProg || nextProg.status === 'LOCKED') {
              updated[nextChapter.id] = {
                bookId: 1,
                chapterId: nextChapter.id,
                status: 'AVAILABLE',
                lastCharOffset: nextProg?.lastCharOffset || 0,
                bestQuizScore: nextProg?.bestQuizScore || 0,
                updatedAt: now,
              };
            }
          }
          return updated;
        });
      }

      setIsQuizCompleted(true);
    }
  };

  const handleResetAllProgress = () => {
    const now = Date.now();
    const fresh: Record<number, ChapterProgress> = {
      1: {
        bookId: 1,
        chapterId: 1,
        status: 'AVAILABLE',
        lastCharOffset: 0,
        bestQuizScore: 0,
        updatedAt: now,
      },
      2: {
        bookId: 1,
        chapterId: 2,
        status: 'LOCKED',
        lastCharOffset: 0,
        bestQuizScore: 0,
        updatedAt: now,
      },
    };
    setProgressMap(fresh);
    setActiveChapterId(1);
    setAnchorCharOffset(0);
    setCurrentPageIndex(0);
  };

  const handleDownloadZip = async () => {
    setIsDownloadingZip(true);
    try {
      await downloadAndroidProjectZip();
    } finally {
      setIsDownloadingZip(false);
    }
  };

  const handleCopySource = (content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedFile(true);
    window.setTimeout(() => setCopiedFile(false), 1800);
  };

  const activeTheme = READER_THEMES[settings.theme];
  const currentPage = pages[currentPageIndex] || pages[0];
  const isLastReaderPage = pages.length > 0 && currentPageIndex === pages.length - 1;

  const currentQuestion = currentChapter.questions[quizQuestionIndex];
  const quizScorePercent =
    currentChapter.questions.length > 0
      ? Math.round((correctAnswersCount / currentChapter.questions.length) * 100)
      : 0;
  const isQuizPassed = quizScorePercent >= PASSING_SCORE_PERCENT;
  const nextChapterObj = SHERLOCK_CHAPTERS.find(
    (c) => c.chapterIndex === currentChapter.chapterIndex + 1
  );

  return (
    <div className="min-h-screen flex flex-col bg-[#F8F6F1] text-slate-900 pb-20 md:pb-0">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-8 px-6 py-3.5 bg-[#F8F6F1]/95 backdrop-blur-md border-b border-stone-200/80">
        {/* Zone 1: Single text element wordmark */}
        <button
          onClick={() => setActiveSection('library')}
          className="text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 font-display text-left"
        >
          Интерактивная Читалка
        </button>

        {/* Zone 2: 4 concise single-line text navigation links */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-stone-600">
          <button
            onClick={() => setActiveSection('library')}
            className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeSection === 'library'
                ? 'border-slate-900 text-slate-900 font-semibold'
                : 'border-transparent'
            }`}
          >
            Библиотека
          </button>
          <button
            onClick={() => setActiveSection('reader')}
            className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeSection === 'reader'
                ? 'border-slate-900 text-slate-900 font-semibold'
                : 'border-transparent'
            }`}
          >
            Читалка
          </button>
          <button
            onClick={() => handleStartQuiz(activeChapterId)}
            className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeSection === 'quiz'
                ? 'border-slate-900 text-slate-900 font-semibold'
                : 'border-transparent'
            }`}
          >
            Тестирование
          </button>
          <button
            onClick={() => setActiveSection('apk')}
            className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeSection === 'apk'
                ? 'border-slate-900 text-slate-900 font-semibold'
                : 'border-transparent'
            }`}
          >
            Сборка APK
          </button>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center shrink-0">
          <button
            onClick={() => {
              if (isInstallable) {
                install();
              } else {
                setShowInstallModal(true);
              }
            }}
            className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 flex items-center gap-2 min-h-[40px]"
          >
            <Smartphone className="w-4 h-4" />
            <span>{isInstalled ? 'Открыть сборку APK' : 'Установить на смартфон'}</span>
          </button>
        </div>
      </header>

      {/* Offline Banner when disconnected */}
      {!isOnline && (
        <div className="bg-amber-900 text-amber-50 px-6 py-2 text-xs font-medium text-center">
          Автономный офлайн-режим активен · Все главы и тесты доступны из локального хранилища
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* SECTION 1: LIBRARY */}
        {activeSection === 'library' && (
          <div className="space-y-8">
            {/* Hero Book Showcase */}
            <div className="bg-white rounded-2xl border border-stone-200/90 p-6 sm:p-8 shadow-xs">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
                {/* Custom Victorian Clothbound Book Cover SVG (Zero-Broken-Image Policy) */}
                <div className="lg:col-span-4 flex justify-center">
                  <div className="w-full max-w-[260px] aspect-[3/4] rounded-xl bg-[#162032] text-amber-50 p-6 flex flex-col justify-between relative overflow-hidden shadow-md border border-amber-500/20">
                    <div className="border border-amber-400/30 rounded-lg p-5 h-full flex flex-col justify-between">
                      <div className="text-xs tracking-widest text-amber-300/80 font-mono-tabular">
                        LONDON · 221B BAKER ST
                      </div>
                      <div className="my-auto py-4 text-center space-y-3">
                        <svg
                          viewBox="0 0 80 80"
                          className="w-14 h-14 mx-auto text-amber-400/90"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                        >
                          <circle cx="34" cy="34" r="20" />
                          <circle cx="34" cy="34" r="14" strokeOpacity="0.4" />
                          <line x1="49" y1="49" x2="68" y2="68" strokeWidth="4" strokeLinecap="round" />
                        </svg>
                        <h2 className="font-display text-2xl sm:text-3xl font-bold leading-tight text-amber-50">
                          Приключения Шерлока Холмса
                        </h2>
                        <div className="w-12 h-px bg-amber-400/50 mx-auto" />
                        <p className="text-xs text-amber-200/80">Артур Конан Дойл</p>
                      </div>
                      <div className="text-[11px] text-amber-300/70 text-center font-mono-tabular">
                        Офлайн-издание · 2 главы · 6 тестов
                      </div>
                    </div>
                  </div>
                </div>

                {/* Book Details & Overall Progress */}
                <div className="lg:col-span-8 flex flex-col justify-between space-y-6">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
                      <span>{SHERLOCK_BOOK.author}</span>
                      <span aria-hidden="true">·</span>
                      <span>{SHERLOCK_BOOK.edition}</span>
                      <span aria-hidden="true">·</span>
                      <span>Офлайн-база Room SQLite</span>
                    </div>

                    <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 font-display">
                      {SHERLOCK_BOOK.title}
                    </h1>

                    <p className="text-stone-600 text-base leading-relaxed max-w-2xl">
                      {SHERLOCK_BOOK.description}
                    </p>
                  </div>

                  {/* Progress Calculation Box (GetBookDetailsWithProgressUseCase) */}
                  <div className="bg-[#F8F6F1] rounded-xl p-5 border border-stone-200/80 space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-slate-800">
                        Общий прогресс прохождения книги
                      </span>
                      <span className="font-mono-tabular font-semibold text-slate-900">
                        {bookStats.completed} из {bookStats.total} глав (
                        {Math.round(bookStats.ratio * 100)}%)
                      </span>
                    </div>
                    <div className="w-full h-2.5 bg-stone-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-700 transition-all duration-300 rounded-full"
                        style={{ width: `${Math.round(bookStats.ratio * 100)}%` }}
                      />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-stone-500">
                      <span>
                        Порог прохождения теста главы: минимум {PASSING_SCORE_PERCENT}% верных ответов
                      </span>
                      <button
                        onClick={handleResetAllProgress}
                        className="text-stone-600 hover:text-slate-900 underline underline-offset-4 font-medium transition-colors"
                      >
                        Сбросить прогресс чтения
                      </button>
                    </div>
                  </div>

                  {/* Primary Action Row */}
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <button
                      onClick={() => handleOpenChapter(1)}
                      className="px-5 py-3 bg-slate-900 text-white text-sm font-semibold rounded-xl hover:bg-slate-800 transition-colors flex items-center gap-2 min-h-[48px]"
                    >
                      <BookOpen className="w-4 h-4" />
                      <span>
                        {progressMap[1]?.lastCharOffset > 0
                          ? 'Продолжить чтение (Глава 1)'
                          : 'Начать чтение книги'}
                      </span>
                    </button>

                    <button
                      onClick={() => setActiveSection('apk')}
                      className="px-5 py-3 bg-stone-100 text-slate-800 border border-stone-300 text-sm font-semibold rounded-xl hover:bg-stone-200/70 transition-colors flex items-center gap-2 min-h-[48px]"
                    >
                      <Download className="w-4 h-4" />
                      <span>Скачать APK-проект для смартфона</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Chapters Table of Contents */}
            <div className="space-y-4">
              <div className="flex items-baseline justify-between">
                <h2 className="text-2xl font-bold text-slate-900 font-display">
                  Оглавление и статус глав
                </h2>
                <span className="text-xs text-stone-500 font-mono-tabular">
                  Каскадная разблокировка глав
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {SHERLOCK_CHAPTERS.map((chapter) => {
                  const prog = progressMap[chapter.id];
                  const status = prog?.status || 'LOCKED';
                  const isLocked = status === 'LOCKED';
                  const isPassed = status === 'PASSED';

                  return (
                    <div
                      key={chapter.id}
                      className={`rounded-2xl border p-6 transition-all flex flex-col justify-between ${
                        isLocked
                          ? 'bg-stone-100/70 border-stone-200/80 opacity-75'
                          : 'bg-white border-stone-200/90 hover:border-stone-300 shadow-xs'
                      }`}
                    >
                      <div className="space-y-3">
                        {/* Unboxed clean metadata with middle-dot separators */}
                        <div className="flex items-center gap-2 text-xs text-stone-500 font-mono-tabular">
                          <span>Глава {chapter.chapterIndex + 1}</span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {isPassed
                              ? `Пройдено (Рекорд теста: ${prog?.bestQuizScore || 0}%)`
                              : isLocked
                              ? 'Заблокировано (Нужно ≥ 75% в Главе 1)'
                              : 'Доступно для чтения'}
                          </span>
                          {prog?.lastCharOffset > 0 && !isLocked && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>Смещение: {prog.lastCharOffset} симв.</span>
                            </>
                          )}
                        </div>

                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="text-xl font-bold text-slate-900 font-display">
                              {chapter.title}
                            </h3>
                            <p className="text-sm text-stone-600 mt-1">{chapter.subtitle}</p>
                          </div>
                          <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-stone-100 text-slate-800">
                            {isPassed ? (
                              <CheckCircle2 className="w-5 h-5 text-emerald-700" />
                            ) : isLocked ? (
                              <Lock className="w-5 h-5 text-stone-400" />
                            ) : (
                              <Play className="w-5 h-5 text-slate-900" />
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="pt-6 mt-6 border-t border-stone-100 flex items-center justify-between gap-3">
                        <button
                          onClick={() => handleOpenChapter(chapter.id)}
                          disabled={isLocked}
                          className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 min-h-[44px] transition-colors ${
                            isLocked
                              ? 'bg-stone-200 text-stone-500 cursor-not-allowed'
                              : 'bg-slate-900 text-white hover:bg-slate-800'
                          }`}
                        >
                          <BookOpen className="w-4 h-4" />
                          <span>
                            {isLocked
                              ? 'Заблокировано'
                              : prog?.lastCharOffset > 0
                              ? 'Продолжить чтение'
                              : 'Читать главу'}
                          </span>
                        </button>

                        {!isLocked && (
                          <button
                            onClick={() => handleStartQuiz(chapter.id)}
                            className="py-2.5 px-4 rounded-xl border border-stone-300 text-slate-800 hover:bg-stone-100 text-xs font-semibold min-h-[44px] transition-colors whitespace-nowrap"
                          >
                            Тест ({chapter.questions.length})
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* SECTION 2: READER (HorizontalPager + Click Zoning + Settings Bottom Sheet) */}
        {activeSection === 'reader' && (
          <div className="max-w-3xl mx-auto">
            <div
              ref={readerContainerRef}
              style={{
                backgroundColor: activeTheme.bgHex,
                color: activeTheme.textHex,
                borderColor: activeTheme.borderHex,
              }}
              className="rounded-2xl border shadow-sm overflow-hidden flex flex-col min-h-[620px] sm:min-h-[680px] relative select-none transition-colors duration-200"
            >
              {/* Reader TopAppBar */}
              {isControlsVisible && (
                <div
                  style={{
                    backgroundColor: activeTheme.surfaceHex,
                    borderColor: activeTheme.borderHex,
                  }}
                  className="px-4 sm:px-6 py-3 border-b flex items-center justify-between gap-4 z-20"
                >
                  <button
                    onClick={() => setActiveSection('library')}
                    className="min-h-[44px] min-w-[44px] flex items-center gap-2 text-sm font-medium rounded-lg px-2 hover:opacity-80 transition-opacity"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span className="hidden sm:inline">Оглавление</span>
                  </button>

                  <div className="text-center truncate">
                    <div className="text-sm font-semibold truncate">{currentChapter.title}</div>
                    <div
                      style={{ color: activeTheme.mutedHex }}
                      className="text-[11px] font-mono-tabular"
                    >
                      Нажмите по краям для листания · Центр — скрыть панели
                    </div>
                  </div>

                  <button
                    onClick={() => setIsSettingsSheetOpen((prev) => !prev)}
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:opacity-80 transition-opacity"
                    aria-label="Настройки чтения"
                  >
                    <Settings className="w-5 h-5" />
                  </button>
                </div>
              )}

              {/* Reader Page Viewport with Click Zoning (Left 25%, Center 50%, Right 25%) */}
              <div
                onClick={handleReaderSurfaceClick}
                className="flex-1 px-6 sm:px-10 py-6 flex flex-col justify-between cursor-pointer relative"
              >
                <div
                  style={{
                    fontSize: `${settings.fontSizeSp}px`,
                    lineHeight: 1.55,
                  }}
                  className="font-reader whitespace-pre-line tracking-normal my-auto"
                >
                  {currentPage?.text}
                </div>

                {/* Page Footer & "Пройти тест" Button on Last Page */}
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="pt-4 mt-4 border-t flex items-center justify-between gap-4 min-h-[56px]"
                  style={{ borderColor: activeTheme.borderHex }}
                >
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handlePageTurn(currentPageIndex - 1)}
                      disabled={currentPageIndex === 0}
                      className="min-h-[44px] px-3 rounded-lg border text-xs font-medium disabled:opacity-35 flex items-center gap-1"
                      style={{ borderColor: activeTheme.borderHex }}
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Назад</span>
                    </button>
                    <button
                      onClick={() => handlePageTurn(currentPageIndex + 1)}
                      disabled={isLastReaderPage}
                      className="min-h-[44px] px-3 rounded-lg border text-xs font-medium disabled:opacity-35 flex items-center gap-1"
                      style={{ borderColor: activeTheme.borderHex }}
                    >
                      <span>Вперед</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div
                    style={{ color: activeTheme.mutedHex }}
                    className="text-xs font-mono-tabular"
                  >
                    Стр. {currentPageIndex + 1} / {pages.length} · Offset {anchorCharOffset}
                  </div>

                  {isLastReaderPage && (
                    <button
                      onClick={() => handleStartQuiz(currentChapter.id)}
                      className="px-4 py-2.5 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-xs font-semibold flex items-center gap-2 min-h-[44px] shadow-xs transition-colors"
                    >
                      <span>Пройти тест</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Reader Bottom Progress Bar */}
              {isControlsVisible && (
                <div
                  style={{
                    backgroundColor: activeTheme.surfaceHex,
                    borderColor: activeTheme.borderHex,
                  }}
                  className="px-6 py-3 border-t z-20 space-y-2"
                >
                  <div className="flex items-center justify-between text-xs font-mono-tabular">
                    <span>
                      Страница {currentPageIndex + 1} из {pages.length}
                    </span>
                    <span>
                      {pages.length > 0
                        ? Math.round(((currentPageIndex + 1) / pages.length) * 100)
                        : 100}
                      % главы
                    </span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-black/10 overflow-hidden">
                    <div
                      className="h-full bg-amber-700 transition-all duration-200"
                      style={{
                        width: `${
                          pages.length > 0
                            ? Math.round(((currentPageIndex + 1) / pages.length) * 100)
                            : 100
                        }%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Settings Modal Bottom Sheet */}
              {isSettingsSheetOpen && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    backgroundColor: activeTheme.surfaceHex,
                    borderColor: activeTheme.borderHex,
                  }}
                  className="absolute bottom-0 left-0 right-0 z-30 rounded-t-3xl border-t p-6 shadow-xl space-y-5"
                >
                  <div className="w-10 h-1.5 bg-stone-400/50 rounded-full mx-auto -mt-2 mb-2" />
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-bold">Настройки чтения (DataStore)</h3>
                    <button
                      onClick={() => setIsSettingsSheetOpen(false)}
                      className="text-xs font-medium underline min-h-[36px] px-2"
                    >
                      Готово
                    </button>
                  </div>

                  {/* Font size control */}
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Type className="w-4 h-4" />
                      <span>Размер шрифта</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() =>
                          setSettings((s) => ({
                            ...s,
                            fontSizeSp: Math.max(14, s.fontSizeSp - 2),
                          }))
                        }
                        disabled={settings.fontSizeSp <= 14}
                        className="min-h-[44px] min-w-[44px] rounded-xl border border-current/20 font-bold text-sm disabled:opacity-40"
                      >
                        А-
                      </button>
                      <span className="font-mono-tabular text-sm font-semibold w-14 text-center">
                        {settings.fontSizeSp} sp
                      </span>
                      <button
                        onClick={() =>
                          setSettings((s) => ({
                            ...s,
                            fontSizeSp: Math.min(28, s.fontSizeSp + 2),
                          }))
                        }
                        disabled={settings.fontSizeSp >= 28}
                        className="min-h-[44px] min-w-[44px] rounded-xl border border-current/20 font-bold text-sm disabled:opacity-40"
                      >
                        А+
                      </button>
                    </div>
                  </div>

                  {/* Theme selector: Light / Sepia / Night */}
                  <div className="space-y-2">
                    <div className="text-sm font-medium">Цветовая тема</div>
                    <div className="grid grid-cols-3 gap-3">
                      {(Object.keys(READER_THEMES) as ReaderThemeId[]).map((themeKey) => {
                        const t = READER_THEMES[themeKey];
                        const isSelected = settings.theme === themeKey;
                        return (
                          <button
                            key={themeKey}
                            onClick={() => setSettings((s) => ({ ...s, theme: themeKey }))}
                            style={{
                              backgroundColor: t.bgHex,
                              color: t.textHex,
                              borderColor: isSelected ? '#B45309' : t.borderHex,
                            }}
                            className={`min-h-[48px] rounded-xl border-2 text-xs font-semibold flex items-center justify-center gap-2 transition-all`}
                          >
                            {isSelected && <Check className="w-3.5 h-3.5 text-amber-700" />}
                            <span>{t.displayName}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* SECTION 3: QUIZ & QUIZ RESULT */}
        {activeSection === 'quiz' && (
          <div className="max-w-2xl mx-auto">
            <div className="bg-white rounded-2xl border border-stone-200/90 p-6 sm:p-8 shadow-xs">
              {!isQuizCompleted && currentQuestion ? (
                <div className="space-y-6">
                  <div className="flex items-center justify-between gap-4 border-b border-stone-100 pb-4">
                    <div>
                      <div className="text-xs text-stone-500 font-mono-tabular">
                        {currentChapter.title} · Вопрос {quizQuestionIndex + 1} из{' '}
                        {currentChapter.questions.length}
                      </div>
                      <h2 className="text-xl font-bold text-slate-900 font-display mt-0.5">
                        Проверка знаний по главе
                      </h2>
                    </div>
                    <div className="text-xs font-mono-tabular font-semibold text-stone-600">
                      Верных: {correctAnswersCount}
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="w-full h-2 bg-stone-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-slate-900 transition-all duration-300"
                      style={{
                        width: `${Math.round(
                          ((quizQuestionIndex + 1) / currentChapter.questions.length) * 100
                        )}%`,
                      }}
                    />
                  </div>

                  {/* Question Text */}
                  <h3 className="text-lg sm:text-xl font-semibold text-slate-900 leading-snug">
                    {currentQuestion.questionText}
                  </h3>

                  {/* Answer Option Cards */}
                  <div className="space-y-3">
                    {currentQuestion.options.map((optText, idx) => {
                      const isSelected = selectedOptionIndex === idx;
                      const isCorrectOption = idx === currentQuestion.correctOptionIndex;

                      let cardStyle =
                        'bg-stone-50/70 border-stone-200 text-slate-800 hover:border-stone-300';
                      if (isAnswerSubmitted) {
                        if (isCorrectOption) {
                          cardStyle = 'bg-emerald-50 border-emerald-600 text-emerald-950 font-medium';
                        } else if (isSelected && !isCorrectOption) {
                          cardStyle = 'bg-rose-50 border-rose-600 text-rose-950';
                        }
                      } else if (isSelected) {
                        cardStyle = 'bg-slate-900/5 border-slate-900 text-slate-900 font-medium';
                      }

                      const letter = String.fromCharCode(65 + idx);

                      return (
                        <button
                          key={idx}
                          disabled={isAnswerSubmitted}
                          onClick={() => setSelectedOptionIndex(idx)}
                          className={`w-full text-left p-4 rounded-xl border-2 transition-all flex items-center justify-between gap-3 min-h-[56px] ${cardStyle}`}
                        >
                          <div className="flex items-center gap-3.5">
                            <span className="w-7 h-7 rounded-full border border-current/25 flex items-center justify-center text-xs font-mono-tabular font-bold shrink-0">
                              {letter}
                            </span>
                            <span className="text-sm sm:text-base">{optText}</span>
                          </div>

                          {isAnswerSubmitted && isCorrectOption && (
                            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                          )}
                          {isAnswerSubmitted && isSelected && !isCorrectOption && (
                            <XCircle className="w-5 h-5 text-rose-600 shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Expandable Explanation Block */}
                  {isAnswerSubmitted && (
                    <div className="rounded-xl bg-amber-50/90 border border-amber-200 p-4 flex items-start gap-3 text-amber-950">
                      <Info className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                      <div className="space-y-1 text-sm">
                        <div className="font-semibold">Пояснение к ответу</div>
                        <p className="text-amber-900/90 leading-relaxed">
                          {currentQuestion.explanation}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Submit / Next Question Action */}
                  <div className="pt-2">
                    {!isAnswerSubmitted ? (
                      <button
                        onClick={handleSubmitQuizAnswer}
                        disabled={selectedOptionIndex === null}
                        className="w-full py-3.5 px-6 rounded-xl bg-slate-900 text-white text-sm font-semibold disabled:opacity-40 hover:bg-slate-800 transition-colors min-h-[48px]"
                      >
                        Проверить ответ
                      </button>
                    ) : (
                      <button
                        onClick={handleNextQuizQuestion}
                        className="w-full py-3.5 px-6 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition-colors flex items-center justify-center gap-2 min-h-[48px]"
                      >
                        <span>
                          {quizQuestionIndex + 1 < currentChapter.questions.length
                            ? 'Следующий вопрос'
                            : 'Завершить тест и рассчитать результат'}
                        </span>
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                /* QuizResultScreen */
                <div className="text-center py-6 space-y-6">
                  <div
                    className={`w-20 h-20 rounded-full mx-auto flex items-center justify-center ${
                      isQuizPassed
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-rose-100 text-rose-700'
                    }`}
                  >
                    {isQuizPassed ? (
                      <Trophy className="w-10 h-10" />
                    ) : (
                      <BookOpen className="w-10 h-10" />
                    )}
                  </div>

                  <div className="space-y-2">
                    <div
                      className={`text-5xl font-bold font-mono-tabular ${
                        isQuizPassed ? 'text-emerald-700' : 'text-rose-700'
                      }`}
                    >
                      {quizScorePercent}%
                    </div>
                    <h2 className="text-2xl font-bold font-display text-slate-900">
                      {isQuizPassed ? 'Глава успешно пройдена!' : 'Тест не пройден'}
                    </h2>
                    <p className="text-sm text-stone-600 max-w-md mx-auto">
                      Правильных ответов: {correctAnswersCount} из{' '}
                      {currentChapter.questions.length}.{' '}
                      {isQuizPassed
                        ? nextChapterObj
                          ? `Следующая глава («${nextChapterObj.title}») разблокирована!`
                          : 'Вы успешно прошли все главы книги!'
                        : `Для разблокировки следующей главы необходимо набрать минимум ${PASSING_SCORE_PERCENT}%.`}
                    </p>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
                    {isQuizPassed ? (
                      <>
                        {nextChapterObj ? (
                          <button
                            onClick={() => handleOpenChapter(nextChapterObj.id)}
                            className="w-full sm:w-auto px-6 py-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold flex items-center justify-center gap-2 min-h-[48px]"
                          >
                            <span>Следующая глава</span>
                            <ArrowRight className="w-4 h-4" />
                          </button>
                        ) : (
                          <button
                            onClick={() => setActiveSection('library')}
                            className="w-full sm:w-auto px-6 py-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold flex items-center justify-center gap-2 min-h-[48px]"
                          >
                            <span>Вернуться в библиотеку</span>
                          </button>
                        )}
                        <button
                          onClick={() => handleStartQuiz(currentChapter.id)}
                          className="w-full sm:w-auto px-5 py-3.5 rounded-xl border border-stone-300 text-slate-800 hover:bg-stone-100 text-sm font-semibold flex items-center justify-center gap-2 min-h-[48px]"
                        >
                          <RotateCcw className="w-4 h-4" />
                          <span>Пройти тест заново</span>
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => handleOpenChapter(currentChapter.id)}
                          className="w-full sm:w-auto px-6 py-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold flex items-center justify-center gap-2 min-h-[48px]"
                        >
                          <BookOpen className="w-4 h-4" />
                          <span>Перечитать главу</span>
                        </button>
                        <button
                          onClick={() => handleStartQuiz(currentChapter.id)}
                          className="w-full sm:w-auto px-6 py-3.5 rounded-xl border border-stone-300 text-slate-800 hover:bg-stone-100 text-sm font-semibold flex items-center justify-center gap-2 min-h-[48px]"
                        >
                          <RotateCcw className="w-4 h-4" />
                          <span>Повторить тест</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* SECTION 4: APK EXPORT & SMARTPHONE INSTALLATION */}
        {activeSection === 'apk' && (
          <div className="space-y-8">
            <div className="bg-white rounded-2xl border border-stone-200/90 p-6 sm:p-8 shadow-xs space-y-6">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 border-b border-stone-100 pb-6">
                <div className="space-y-2 max-w-2xl">
                  <div className="text-xs text-stone-500 font-mono-tabular">
                    Kotlin 2.0.21 · Target SDK 35 · Room 2.6.1 · GitHub Actions APK Builder
                  </div>
                  <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 font-display">
                    Установка на смартфон и сборка нативного APK
                  </h1>
                  <p className="text-sm text-stone-600 leading-relaxed">
                    Поскольку браузерная среда выполняется в веб-контейнере, мы подготовили два
                    готовых пути установки программы на ваш смартфон: мгновенная офлайн-установка
                    PWA в один тап прямо сейчас или скачивание готового проекта Android Studio с
                    облачным автосборщиком <code className="font-mono-tabular">app-debug.apk</code>.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3 shrink-0">
                  <button
                    onClick={handleDownloadZip}
                    disabled={isDownloadingZip}
                    className="px-5 py-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold flex items-center gap-2.5 min-h-[48px] shadow-xs transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    <span>
                      {isDownloadingZip
                        ? 'Упаковка архива...'
                        : 'Скачать Android-проект + сборщик APK (.zip)'}
                    </span>
                  </button>
                </div>
              </div>

              {/* Two Installation Paths Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Method 1: Cloud GitHub Actions APK / Android Studio */}
                <div className="rounded-xl bg-[#F8F6F1] border border-stone-200/90 p-5 space-y-3">
                  <h3 className="text-lg font-bold text-slate-900 font-display">
                    Способ 1. Получить файл app-debug.apk (без Android Studio на ПК)
                  </h3>
                  <ol className="text-sm text-stone-700 space-y-2 list-decimal list-inside leading-relaxed">
                    <li>
                      Нажмите кнопку{' '}
                      <strong className="text-slate-900">
                        «Скачать Android-проект + сборщик APK (.zip)»
                      </strong>{' '}
                      выше.
                    </li>
                    <li>
                      В архив уже встроен файл{' '}
                      <code className="text-xs font-mono-tabular bg-white px-1.5 py-0.5 rounded border border-stone-200">
                        .github/workflows/build-apk.yml
                      </code>
                      .
                    </li>
                    <li>
                      Загрузите файлы в любой репозиторий GitHub — облачный сервер GitHub Actions
                      автоматически скомпилирует{' '}
                      <code className="text-xs font-mono-tabular bg-white px-1.5 py-0.5 rounded border border-stone-200">
                        InteractiveReader-debug.apk
                      </code>{' '}
                      за 2 минуты во вкладке <strong>Actions → Artifacts</strong>.
                    </li>
                    <li>
                      Либо откройте папку в <strong>Android Studio</strong> и выберите{' '}
                      <strong>Build → Build APK(s)</strong>.
                    </li>
                  </ol>
                </div>

                {/* Method 2: Direct Smartphone Install (PWA Standalone) */}
                <div className="rounded-xl bg-[#F8F6F1] border border-stone-200/90 p-5 space-y-3 flex flex-col justify-between">
                  <div className="space-y-3">
                    <h3 className="text-lg font-bold text-slate-900 font-display">
                      Способ 2. Прямая установка на телефон за 5 секунд (PWA)
                    </h3>
                    <p className="text-sm text-stone-700 leading-relaxed">
                      Эта версия приложения уже включает полноценный Service Worker, офлайн-базу
                      прогресса, математическую пагинацию и оба рассказа о Шерлоке Холмсе. При
                      установке на рабочий стол смартфона она работает без адресной строки и без
                      интернета.
                    </p>
                  </div>
                  <div className="pt-2">
                    <button
                      onClick={() => {
                        if (isInstallable) {
                          install();
                        } else {
                          setShowInstallModal(true);
                        }
                      }}
                      className="w-full py-3 px-4 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-xs font-semibold flex items-center justify-center gap-2 min-h-[44px] transition-colors"
                    >
                      <Smartphone className="w-4 h-4" />
                      <span>Инструкция и QR-код для установки на телефон</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Interactive Source Code Inspector */}
              <div className="pt-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-slate-900 font-display">
                    Файлы внутри архива Android-проекта ({projectFiles.length})
                  </h2>
                  <button
                    onClick={() =>
                      handleCopySource(projectFiles[selectedSourceIndex]?.content || '')
                    }
                    className="px-3 py-1.5 rounded-lg border border-stone-300 text-xs font-medium text-slate-700 hover:bg-stone-100 flex items-center gap-1.5"
                  >
                    {copiedFile ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-700" />
                        <span>Скопировано</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Копировать код файла</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                  <div className="lg:col-span-4 space-y-1.5 max-h-[440px] overflow-y-auto pr-1">
                    {projectFiles.map((file, idx) => (
                      <button
                        key={file.path}
                        onClick={() => setSelectedSourceIndex(idx)}
                        className={`w-full text-left p-3 rounded-xl border text-xs transition-colors ${
                          selectedSourceIndex === idx
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-[#F8F6F1] text-slate-800 border-stone-200/80 hover:bg-stone-200/50'
                        }`}
                      >
                        <div className="font-mono-tabular font-semibold truncate">{file.path}</div>
                        <div
                          className={`text-[11px] mt-0.5 truncate ${
                            selectedSourceIndex === idx ? 'text-stone-300' : 'text-stone-500'
                          }`}
                        >
                          {file.description}
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="lg:col-span-8 bg-slate-950 text-slate-100 rounded-xl p-4 overflow-x-auto max-h-[440px]">
                    <div className="text-xs font-mono-tabular text-amber-400 mb-2 pb-2 border-b border-slate-800">
                      {projectFiles[selectedSourceIndex]?.path}
                    </div>
                    <pre className="text-xs font-mono-tabular leading-relaxed">
                      <code>{projectFiles[selectedSourceIndex]?.content}</code>
                    </pre>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Mobile Fixed Bottom Navigation Bar (Thumb Zone Optimization) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-stone-200 grid grid-cols-4 items-center h-16">
        <button
          onClick={() => setActiveSection('library')}
          className={`flex flex-col items-center justify-center h-full ${
            activeSection === 'library' ? 'text-slate-900 font-semibold' : 'text-stone-500'
          }`}
        >
          <BookOpen className="w-5 h-5" />
          <span className="text-[10px] mt-1">Библиотека</span>
        </button>
        <button
          onClick={() => setActiveSection('reader')}
          className={`flex flex-col items-center justify-center h-full ${
            activeSection === 'reader' ? 'text-slate-900 font-semibold' : 'text-stone-500'
          }`}
        >
          <Type className="w-5 h-5" />
          <span className="text-[10px] mt-1">Читалка</span>
        </button>
        <button
          onClick={() => handleStartQuiz(activeChapterId)}
          className={`flex flex-col items-center justify-center h-full ${
            activeSection === 'quiz' ? 'text-slate-900 font-semibold' : 'text-stone-500'
          }`}
        >
          <HelpCircle className="w-5 h-5" />
          <span className="text-[10px] mt-1">Тест</span>
        </button>
        <button
          onClick={() => setActiveSection('apk')}
          className={`flex flex-col items-center justify-center h-full ${
            activeSection === 'apk' ? 'text-slate-900 font-semibold' : 'text-stone-500'
          }`}
        >
          <FileCode2 className="w-5 h-5" />
          <span className="text-[10px] mt-1">APK</span>
        </button>
      </nav>

      {/* Smartphone Installation Modal */}
      {showInstallModal && (
        <div
          onClick={() => setShowInstallModal(false)}
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl max-w-md w-full p-6 space-y-5 shadow-xl border border-stone-200"
          >
            <div className="space-y-1">
              <h3 className="text-xl font-bold text-slate-900 font-display">
                Установка программы на смартфон
              </h3>
              <p className="text-xs text-stone-500">
                Выберите удобный вариант: прямая установка из браузера или сборка APK
              </p>
            </div>

            <div className="space-y-3 text-sm text-stone-700">
              <div className="p-3.5 rounded-xl bg-[#F8F6F1] border border-stone-200 space-y-1.5">
                <div className="font-semibold text-slate-900">
                  На Android (Chrome / Яндекс Браузер):
                </div>
                <p className="text-xs leading-relaxed">
                  Откройте меню браузера (три точки в правом верхнем углу) и выберите{' '}
                  <strong>«Установить приложение»</strong> или{' '}
                  <strong>«Добавить на главный экран»</strong>.
                </p>
              </div>

              {isIOS || true ? (
                <div className="p-3.5 rounded-xl bg-[#F8F6F1] border border-stone-200 space-y-1.5">
                  <div className="font-semibold text-slate-900">На iPhone / iPad (Safari):</div>
                  <p className="text-xs leading-relaxed">
                    Нажмите кнопку <strong>«Поделиться»</strong> в нижней панели Safari и выберите{' '}
                    <strong>«На экран „Домой“»</strong>.
                  </p>
                </div>
              ) : null}
            </div>

            <div className="flex flex-col gap-2.5 pt-1">
              <button
                onClick={() => {
                  setShowInstallModal(false);
                  setActiveSection('apk');
                  handleDownloadZip();
                }}
                className="w-full py-3 px-4 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 flex items-center justify-center gap-2 min-h-[44px]"
              >
                <Download className="w-4 h-4" />
                <span>Скачать Android Studio + APK проект (.zip)</span>
              </button>
              <button
                onClick={() => setShowInstallModal(false)}
                className="w-full py-2.5 px-4 rounded-xl border border-stone-300 text-slate-700 text-xs font-semibold hover:bg-stone-100 min-h-[42px]"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
