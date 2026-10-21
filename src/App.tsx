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
  Search,
  Settings,
  Trophy,
  Type,
  X,
  XCircle,
} from 'lucide-react';
import {
  BookData,
  ChapterData,
  ChapterProgressRecord,
  ChapterStatus,
  LIBRARY_BOOKS,
} from './data/booksCatalogData';
import {
  findPageIndexForOffset,
  getOffsetForPage,
  paginateChapterText,
  READER_THEMES,
  ReaderThemeId,
} from './data/sherlockData';
import { useOnlineStatus } from './hooks/usePWAInstall';
import {
  downloadAndroidProjectZip,
  getAndroidProjectFiles,
} from './utils/androidProjectBuilder';
import {
  auditNormalizedChapter,
  buildChapterFromNormalizedDocument,
  DEMO_RAW_CHAPTER_INPUT,
  normalizeChapterContent,
  NormalizedChapterDocument,
  normalizeForFts5,
  parseNormalizedJsonInput,
} from './utils/chapterContentArchitect';

type ActiveSection = 'library' | 'reader' | 'quiz' | 'apk';

const STORAGE_KEY_PROGRESS_V2 = 'interactive_reader_catalog_progress_v2';
const STORAGE_KEY_SETTINGS = 'interactive_reader_datastore_settings_v1';
const STORAGE_KEY_CUSTOM_CHAPTERS = 'interactive_reader_custom_chapters_v1';
const PASSING_SCORE_PERCENT = 75;

interface StoredSettings {
  fontSizeSp: number;
  arabicScaleFactor: number;
  theme: ReaderThemeId;
}

const ARABIC_WORD_WITH_TASHKEEL_REGEX =
  /([\u0610-\u061A\u0620-\u065F\u066E-\u06D3\u06D5-\u06ED\u0640\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+)/g;

function isArabicParagraphLine(line: string): boolean {
  const hasArabic = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(
    line
  );
  if (!hasArabic) return false;
  const hasCyrillicOrLatin = /[А-Яа-яЁёA-Za-z]/.test(line);
  return !hasCyrillicOrLatin;
}

function renderMixedArabicFragment(
  textFragment: string,
  baseFontSizeSp: number,
  arabicScaleFactor: number,
  keyPrefix: string
): React.ReactNode {
  if (!textFragment || Math.abs(arabicScaleFactor - 1.0) < 0.001) {
    return textFragment;
  }
  const parts = textFragment.split(ARABIC_WORD_WITH_TASHKEEL_REGEX);
  if (parts.length === 1) {
    return textFragment;
  }
  const scaledPx = Math.round(baseFontSizeSp * arabicScaleFactor * 10) / 10;
  return parts.map((chunk, i) => {
    if (i % 2 === 1) {
      return (
        <span
          key={`${keyPrefix}-ar-${i}`}
          style={{
            fontSize: `${scaledPx}px`,
          }}
        >
          {chunk}
        </span>
      );
    }
    return <React.Fragment key={`${keyPrefix}-tx-${i}`}>{chunk}</React.Fragment>;
  });
}

function getInitialCatalogProgress(): Record<number, ChapterProgressRecord> {
  const initial: Record<number, ChapterProgressRecord> = {};
  for (const book of LIBRARY_BOOKS) {
    for (const ch of book.chapters) {
      initial[ch.id] = {
        chapterId: ch.id,
        isCompleted: false,
        testPassed: false,
        score: 0,
        lastCharOffset: 0,
      };
    }
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PROGRESS_V2);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...initial, ...parsed };
    }
  } catch {
    // ignore storage errors
  }
  return initial;
}

function getInitialSettings(): StoredSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        fontSizeSp: Math.min(28, Math.max(14, Number(parsed.fontSizeSp) || 18)),
        arabicScaleFactor: Math.min(
          2.0,
          Math.max(1.0, Number(parsed.arabicScaleFactor) || 1.35)
        ),
        theme: parsed.theme in READER_THEMES ? parsed.theme : 'LIGHT',
      };
    }
  } catch {
    // ignore
  }
  return {
    fontSizeSp: 18,
    arabicScaleFactor: 1.35,
    theme: 'LIGHT',
  };
}

/**
 * Renders a resilient 3:4 book poster with custom SVG artwork and optional cover image
 */
function BookCoverPoster({
  book,
  className = '',
}: {
  book: BookData;
  className?: string;
}) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);

  return (
    <div
      style={{
        backgroundColor: book.coverPalette.bg,
        color: book.coverPalette.text,
      }}
      className={`aspect-[3/4] rounded-xl relative overflow-hidden select-none shadow-xs border border-black/10 ${className}`}
    >
      {/* Editorial SVG Vector Poster (always rendered underneath or when offline) */}
      <div className="absolute inset-0 p-4 flex flex-col justify-between">
        <div
          style={{ borderColor: `${book.coverPalette.accent}55` }}
          className="border rounded-lg p-3.5 h-full flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-[10px] font-mono-tabular opacity-75">
            <span>{book.year}</span>
            <span>
              {book.id === 5 ? 'СУННА · АДАБ' : book.id === 6 ? 'МОНОГРАФИЯ' : 'КЛАССИКА'}
            </span>
          </div>

          <div className="my-auto py-2 text-center space-y-2.5">
            <div
              style={{ color: book.coverPalette.accent }}
              className="w-11 h-11 mx-auto flex items-center justify-center"
            >
              {book.coverPalette.motif === 'arch' && (
                <svg viewBox="0 0 48 48" className="w-10 h-10" fill="none" stroke="currentColor" strokeWidth="2">
                  <path
                    d="M10 40V22C10 13 24 6 24 6C24 6 38 13 38 22V40H10Z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <polygon
                    points="24,14 26.5,19.5 32,22 26.5,24.5 24,30 21.5,24.5 16,22 21.5,19.5"
                    strokeLinejoin="round"
                  />
                  <line x1="14" y1="36" x2="34" y2="36" strokeOpacity="0.5" />
                </svg>
              )}
              {book.coverPalette.motif === 'axe' && (
                <svg viewBox="0 0 48 48" className="w-10 h-10" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <circle cx="24" cy="24" r="18" strokeOpacity="0.35" />
                  <path d="M16 34L32 14M26 12C32 14 35 19 33 25L23 20" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
              {book.coverPalette.motif === 'moon' && (
                <svg viewBox="0 0 48 48" className="w-10 h-10" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M30 10A14 14 0 1 0 38 32A11 11 0 0 1 30 10Z" />
                  <circle cx="18" cy="18" r="2" fill="currentColor" />
                </svg>
              )}
              {book.coverPalette.motif === 'eye' && (
                <svg viewBox="0 0 48 48" className="w-10 h-10" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M4 24C10 14 17 10 24 10C31 10 38 14 44 24C38 34 31 38 24 38C17 38 10 34 4 24Z" />
                  <circle cx="24" cy="24" r="6" />
                  <circle cx="24" cy="24" r="2" fill="currentColor" />
                </svg>
              )}
              {book.coverPalette.motif === 'star' && (
                <svg viewBox="0 0 48 48" className="w-10 h-10" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <polygon points="24,6 29,18 42,19 32,28 35,41 24,34 13,41 16,28 6,19 19,18" />
                </svg>
              )}
            </div>

            <div className="font-display font-bold text-base sm:text-lg leading-tight line-clamp-3">
              {book.title}
            </div>
            <div
              style={{ backgroundColor: book.coverPalette.accent }}
              className="w-8 h-0.5 mx-auto opacity-70"
            />
            <div className="text-[11px] opacity-85 line-clamp-1">{book.author}</div>
          </div>

          <div className="text-[10px] font-mono-tabular text-center opacity-65">
            {book.chapters.length} {book.chapters.length >= 5 ? 'глав' : 'главы'} ·{' '}
            {book.chapters.reduce((acc, c) => acc + c.quiz.length, 0)} тестов
          </div>
        </div>
      </div>

      {/* High-res cover image overlay with graceful fallback */}
      {!imgError && (
        <img
          src={book.coverUrl}
          alt={book.title}
          referrerPolicy="no-referrer"
          onLoad={() => setImgLoaded(true)}
          onError={() => setImgError(true)}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
            imgLoaded ? 'opacity-25 mix-blend-luminosity' : 'opacity-0'
          }`}
        />
      )}
    </div>
  );
}

export default function App() {
  const [activeSection, setActiveSection] = useState<ActiveSection>('library');
  const [progressMap, setProgressMap] = useState<Record<number, ChapterProgressRecord>>(
    getInitialCatalogProgress
  );
  const [settings, setSettings] = useState<StoredSettings>(getInitialSettings);

  // Library MVI State (Search with 300ms debounce + BottomSheet BookDetails)
  const [searchInput, setSearchInput] = useState<string>('');
  const [debouncedQuery, setDebouncedQuery] = useState<string>('');
  const [selectedBookIdForSheet, setSelectedBookIdForSheet] = useState<number | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Active Book & Chapter for Reader / Quiz (defaults to 'Простые благодеяния')
  const [activeBookId, setActiveBookId] = useState<number>(5);
  const [activeChapterId, setActiveChapterId] = useState<number>(501);

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

  // APK Export State
  const [isDownloadingZip, setIsDownloadingZip] = useState<boolean>(false);
  const [isDownloadingApk, setIsDownloadingApk] = useState<boolean>(false);
  const [apkVerifiedBytes, setApkVerifiedBytes] = useState<number | null>(null);
  const [selectedSourceIndex, setSelectedSourceIndex] = useState<number>(0);
  const [copiedFile, setCopiedFile] = useState<boolean>(false);

  // Content-Architect (JSON / FTS5 / BiDi / Footnotes) State
  const [customChaptersByBook, setCustomChaptersByBook] = useState<Record<number, ChapterData[]>>(
    () => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY_CUSTOM_CHAPTERS);
        return raw ? JSON.parse(raw) : {};
      } catch {
        return {};
      }
    }
  );
  const [isArchitectOpen, setIsArchitectOpen] = useState<boolean>(false);
  const [architectMode, setArchitectMode] = useState<'inspect' | 'create_raw' | 'create_json'>(
    'inspect'
  );
  const [architectBookId, setArchitectBookId] = useState<number>(5);
  const [architectChapterId, setArchitectChapterId] = useState<number>(506);
  const [rawChapterTitle, setRawChapterTitle] = useState<string>(
    '22. Примирение'
  );
  const [rawBookSlug, setRawBookSlug] = useState<string>('easy_good_deeds');
  const [rawChapterNumber, setRawChapterNumber] = useState<number>(26);
  const [rawChunkInfo, setRawChunkInfo] = useState<string>('часть 1 из 1');
  const [rawInputText, setRawInputText] = useState<string>(DEMO_RAW_CHAPTER_INPUT);
  const [jsonInputText, setJsonInputText] = useState<string>('');
  const [activeFootnotePopup, setActiveFootnotePopup] = useState<{
    id: string;
    anchor_text: string;
    text: string | null;
    is_missing: boolean;
  } | null>(null);
  const [copiedJsonBadge, setCopiedJsonBadge] = useState<boolean>(false);

  const isOnline = useOnlineStatus();
  const projectFiles = useMemo(() => getAndroidProjectFiles(), []);
  const totalCatalogChaptersCount = useMemo(
    () => LIBRARY_BOOKS.reduce((acc, b) => acc + b.chapters.length, 0),
    []
  );
  const totalCatalogQuestionsCount = useMemo(
    () =>
      LIBRARY_BOOKS.reduce(
        (acc, b) => acc + b.chapters.reduce((qa, c) => qa + c.quiz.length, 0),
        0
      ),
    []
  );

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_CUSTOM_CHAPTERS, JSON.stringify(customChaptersByBook));
    } catch {}
  }, [customChaptersByBook]);

  // Debounce search query (300ms) as specified in LibraryViewModel requirement
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(searchInput.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // Toast auto-dismiss
  const showToast = (msg: string) => {
    setToastMessage(msg);
  };
  useEffect(() => {
    if (!toastMessage) return;
    const t = window.setTimeout(() => setToastMessage(null), 3200);
    return () => window.clearTimeout(t);
  }, [toastMessage]);

  // Verify APK availability on server
  useEffect(() => {
    fetch(`/InteractiveReader.apk?check=${Date.now()}`, { method: 'HEAD', cache: 'no-store' })
      .then((res) => {
        if (res.ok) {
          const len = Number(res.headers.get('content-length')) || 175102;
          setApkVerifiedBytes(len);
        }
      })
      .catch(() => {});
  }, []);

  // Persist Progress & Settings
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_PROGRESS_V2, JSON.stringify(progressMap));
    } catch {}
  }, [progressMap]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
    } catch {}
  }, [settings]);

  // GetLibraryBooksUseCase + GetBookDetailsUseCase computation (merged with custom chapters)
  const booksWithProgress = useMemo(() => {
    return LIBRARY_BOOKS.map((baseBook) => {
      const extraChapters = customChaptersByBook[baseBook.id] || [];
      const book: BookData = {
        ...baseBook,
        chapters: [...baseBook.chapters, ...extraChapters],
      };
      const sortedChapters = [...book.chapters].sort((a, b) => a.chapterOrder - b.chapterOrder);
      let isPreviousPassed = true; // First chapter is always unlocked

      const chapterItems = sortedChapters.map((ch, idx) => {
        const prog = progressMap[ch.id];
        const isPassed = Boolean(prog?.isCompleted && prog?.testPassed);
        let status: ChapterStatus;
        if (isPassed) {
          status = 'PASSED';
        } else if (idx === 0 || isPreviousPassed) {
          status = 'AVAILABLE';
        } else {
          status = 'LOCKED';
        }
        isPreviousPassed = isPassed;

        return {
          ...ch,
          status,
          score: prog?.score || 0,
          lastCharOffset: prog?.lastCharOffset || 0,
        };
      });

      const totalChaptersCount = chapterItems.length;
      const completedChaptersCount = chapterItems.filter((c) => c.status === 'PASSED').length;
      const progressRatio =
        totalChaptersCount > 0 ? completedChaptersCount / totalChaptersCount : 0;

      return {
        book,
        completedChaptersCount,
        totalChaptersCount,
        progressRatio,
        chapters: chapterItems,
      };
    });
  }, [progressMap, customChaptersByBook]);

  // Filtered books by debounced search query (title or author, case-insensitive)
  const filteredBooks = useMemo(() => {
    if (!debouncedQuery) return booksWithProgress;
    const q = debouncedQuery.toLowerCase();
    return booksWithProgress.filter(
      (item) =>
        item.book.title.toLowerCase().includes(q) ||
        item.book.author.toLowerCase().includes(q)
    );
  }, [booksWithProgress, debouncedQuery]);

  // Selected BookDetails for ModalBottomSheet
  const selectedBookDetails = useMemo(() => {
    if (selectedBookIdForSheet === null) return null;
    return booksWithProgress.find((b) => b.book.id === selectedBookIdForSheet) || null;
  }, [booksWithProgress, selectedBookIdForSheet]);

  // Active Book & Chapter for Reader/Quiz
  const activeBookEntry = useMemo(
    () => booksWithProgress.find((b) => b.book.id === activeBookId) || booksWithProgress[0],
    [booksWithProgress, activeBookId]
  );

  const currentChapter = useMemo(() => {
    return (
      activeBookEntry.chapters.find((c) => c.id === activeChapterId) ||
      activeBookEntry.chapters[0]
    );
  }, [activeBookEntry, activeChapterId]);

  // Observe reader viewport width only (height is fixed so page count never changes when turning to a shorter page)
  useEffect(() => {
    const el = readerContainerRef.current;
    if (!el) return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 100) {
        const horizontalPadding = rect.width >= 640 ? 80 : 48; // matches px-6 (48px) and sm:px-10 (80px)
        const nextWidth = Math.floor(rect.width - horizontalPadding);
        const nextHeight = rect.width >= 640 ? 430 : 390;
        setReaderBoxSize((prev) => {
          if (prev.width === nextWidth && prev.height === nextHeight) {
            return prev;
          }
          return { width: nextWidth, height: nextHeight };
        });
      }
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, [activeSection]);

  // Paginate current chapter
  const pages = useMemo(() => {
    return paginateChapterText(
      currentChapter.id,
      currentChapter.content,
      readerBoxSize.width,
      readerBoxSize.height,
      settings.fontSizeSp
    );
  }, [
    currentChapter.id,
    currentChapter.content,
    readerBoxSize.width,
    readerBoxSize.height,
    settings.fontSizeSp,
  ]);

  useEffect(() => {
    const restoredIndex = findPageIndexForOffset(pages, anchorCharOffset);
    setCurrentPageIndex(restoredIndex);
  }, [pages]);

  // Debounced (300ms) save of lastCharOffset
  useEffect(() => {
    if (activeSection !== 'reader') return;
    const timer = window.setTimeout(() => {
      setProgressMap((prev) => {
        const existing = prev[currentChapter.id];
        if (!existing || existing.lastCharOffset === anchorCharOffset) return prev;
        return {
          ...prev,
          [currentChapter.id]: {
            ...existing,
            lastCharOffset: anchorCharOffset,
          },
        };
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [anchorCharOffset, currentChapter.id, activeSection]);

  // Handle chapter click from BookDetailsBottomSheet (MVI LibraryIntent.OnChapterClicked)
  const handleChapterClicked = (
    bookId: number,
    chapter: ChapterData & { status: ChapterStatus; lastCharOffset: number }
  ) => {
    if (chapter.status === 'LOCKED') {
      showToast('Сначала пройдите предыдущую главу и тест!');
      return;
    }
    setActiveBookId(bookId);
    setActiveChapterId(chapter.id);
    setAnchorCharOffset(chapter.lastCharOffset || 0);
    setSelectedBookIdForSheet(null);
    setIsSettingsSheetOpen(false);
    setActiveSection('reader');
  };

  const handlePageTurn = (targetIndex: number) => {
    if (pages.length === 0) return;
    const clamped = Math.min(Math.max(0, targetIndex), pages.length - 1);
    setCurrentPageIndex(clamped);
    const newOffset = getOffsetForPage(pages, clamped);
    setAnchorCharOffset(newOffset);
  };

  const handleReaderSurfaceClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isSettingsSheetOpen) {
      setIsSettingsSheetOpen(false);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;

    if (clickX < width * 0.25) {
      if (currentPageIndex > 0) handlePageTurn(currentPageIndex - 1);
    } else if (clickX > width * 0.75) {
      if (currentPageIndex < pages.length - 1) handlePageTurn(currentPageIndex + 1);
    } else {
      setIsControlsVisible((prev) => !prev);
    }
  };

  const handleStartQuiz = (bookId: number = activeBookId, chapterId: number = currentChapter.id) => {
    setActiveBookId(bookId);
    setActiveChapterId(chapterId);
    setQuizQuestionIndex(0);
    setSelectedOptionIndex(null);
    setIsAnswerSubmitted(false);
    setCorrectAnswersCount(0);
    setIsQuizCompleted(false);
    setSelectedBookIdForSheet(null);
    setActiveSection('quiz');
  };

  const handleSubmitQuizAnswer = () => {
    if (selectedOptionIndex === null || isAnswerSubmitted) return;
    const question = currentChapter.quiz[quizQuestionIndex];
    if (!question) return;

    const isCorrect = selectedOptionIndex === question.correctAnswerIndex;
    const updatedCorrect = isCorrect ? correctAnswersCount + 1 : correctAnswersCount;
    setCorrectAnswersCount(updatedCorrect);
    setIsAnswerSubmitted(true);
  };

  const handleNextQuizQuestion = () => {
    if (!isAnswerSubmitted) return;
    const totalQ = currentChapter.quiz.length;

    if (quizQuestionIndex + 1 < totalQ) {
      setQuizQuestionIndex((prev) => prev + 1);
      setSelectedOptionIndex(null);
      setIsAnswerSubmitted(false);
    } else {
      const finalScore = Math.round((correctAnswersCount / totalQ) * 100);
      const isPassed = finalScore >= PASSING_SCORE_PERCENT;

      if (isPassed) {
        setProgressMap((prev) => {
          const existing = prev[currentChapter.id] || {
            chapterId: currentChapter.id,
            isCompleted: false,
            testPassed: false,
            score: 0,
            lastCharOffset: 0,
          };
          return {
            ...prev,
            [currentChapter.id]: {
              ...existing,
              isCompleted: true,
              testPassed: true,
              score: Math.max(existing.score, finalScore),
            },
          };
        });
      }
      setIsQuizCompleted(true);
    }
  };

  const handleResetCatalogProgress = () => {
    const fresh: Record<number, ChapterProgressRecord> = {};
    for (const book of LIBRARY_BOOKS) {
      for (const ch of book.chapters) {
        fresh[ch.id] = {
          chapterId: ch.id,
          isCompleted: false,
          testPassed: false,
          score: 0,
          lastCharOffset: 0,
        };
      }
    }
    setProgressMap(fresh);
    showToast('Прогресс всех книг сброшен');
  };

  const handleDownloadApk = async () => {
    setIsDownloadingApk(true);
    try {
      const response = await fetch(`/InteractiveReader.apk?dl=${Date.now()}`, {
        cache: 'no-store',
      });
      const buffer = await response.arrayBuffer();
      setApkVerifiedBytes(buffer.byteLength);
      const blob = new Blob([buffer], {
        type: 'application/vnd.android.package-archive',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'InteractiveReader.apk';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } finally {
      setIsDownloadingApk(false);
    }
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

  const currentQuestion = currentChapter.quiz[quizQuestionIndex];
  const quizScorePercent =
    currentChapter.quiz.length > 0
      ? Math.round((correctAnswersCount / currentChapter.quiz.length) * 100)
      : 0;
  const isQuizPassed = quizScorePercent >= PASSING_SCORE_PERCENT;
  const nextChapterObj = activeBookEntry.chapters.find(
    (c) => c.chapterOrder === currentChapter.chapterOrder + 1
  );

  const currentReaderNormalizedDoc = useMemo(() => {
    const slug =
      activeBookEntry.book.id === 5 ? 'prostye-blagodeyaniya' : 'psihologiya-islamskiy-diskurs';
    return normalizeChapterContent({
      book_id: slug,
      book_title: activeBookEntry.book.title,
      chapter_number: currentChapter.chapterOrder,
      chapter_title_ru: currentChapter.title,
      chunk_info: 'часть 1 из 1',
      raw_content: currentChapter.content,
    });
  }, [activeBookEntry.book.id, activeBookEntry.book.title, currentChapter]);

  // Content-Architect: compute NormalizedChapterDocument for inspected or created chapter
  const architectBookEntry = useMemo(
    () => booksWithProgress.find((b) => b.book.id === architectBookId) || booksWithProgress[0],
    [booksWithProgress, architectBookId]
  );

  const architectInspectedChapter = useMemo(
    () =>
      architectBookEntry.chapters.find((c) => c.id === architectChapterId) ||
      architectBookEntry.chapters[0],
    [architectBookEntry, architectChapterId]
  );

  const architectDocumentResult = useMemo((): {
    doc: NormalizedChapterDocument;
    error: string | null;
  } => {
    if (architectMode === 'inspect') {
      const slug =
        architectBookEntry.book.id === 5 ? 'prostye-blagodeyaniya' : 'psihologiya-islamskiy-diskurs';
      const doc = normalizeChapterContent({
        book_id: slug,
        book_title: architectBookEntry.book.title,
        chapter_number: architectInspectedChapter.chapterOrder,
        chapter_title_ru: architectInspectedChapter.title,
        chunk_info: 'часть 1 из 1',
        raw_content: architectInspectedChapter.content,
      });
      return { doc, error: null };
    }
    if (architectMode === 'create_raw') {
      const doc = normalizeChapterContent({
        book_id: rawBookSlug || 'prostye-blagodeyaniya',
        book_title: architectBookEntry.book.title,
        chapter_number: rawChapterNumber || architectBookEntry.chapters.length + 1,
        chapter_title_ru: rawChapterTitle.trim() || `Глава ${rawChapterNumber}`,
        chunk_info: rawChunkInfo || 'часть 1 из 1',
        raw_content: rawInputText,
      });
      return { doc, error: null };
    }
    // create_json mode
    const parsed = parseNormalizedJsonInput(jsonInputText);
    if (parsed.doc) {
      return { doc: parsed.doc, error: null };
    }
    const fallbackDoc = normalizeChapterContent({
      book_id: rawBookSlug || 'prostye-blagodeyaniya',
      book_title: architectBookEntry.book.title,
      chapter_number: rawChapterNumber || architectBookEntry.chapters.length + 1,
      chapter_title_ru: rawChapterTitle.trim() || `Глава ${rawChapterNumber}`,
      chunk_info: rawChunkInfo || 'часть 1 из 1',
      raw_content: DEMO_RAW_CHAPTER_INPUT,
    });
    return { doc: fallbackDoc, error: parsed.error };
  }, [
    architectMode,
    architectBookEntry,
    architectInspectedChapter,
    rawBookSlug,
    rawChapterNumber,
    rawChapterTitle,
    rawChunkInfo,
    rawInputText,
    jsonInputText,
  ]);

  const architectAudit = useMemo(
    () => auditNormalizedChapter(architectDocumentResult.doc),
    [architectDocumentResult.doc]
  );

  const handleAddNormalizedChapterToBook = () => {
    if (architectMode === 'create_json' && architectDocumentResult.error) {
      showToast(`Ошибка JSON: ${architectDocumentResult.error}`);
      return;
    }
    const targetBook = architectBookEntry.book;
    const nextOrder = targetBook.chapters.length + 1;
    const nextId = targetBook.id * 100 + nextOrder;
    const newChapter = buildChapterFromNormalizedDocument(
      architectDocumentResult.doc,
      targetBook.id,
      nextId,
      nextOrder
    );

    setCustomChaptersByBook((prev) => ({
      ...prev,
      [targetBook.id]: [...(prev[targetBook.id] || []), newChapter],
    }));

    setProgressMap((prev) => ({
      ...prev,
      [newChapter.id]: {
        chapterId: newChapter.id,
        isCompleted: false,
        testPassed: false,
        score: 0,
        lastCharOffset: 0,
      },
    }));

    setArchitectChapterId(newChapter.id);
    setArchitectMode('inspect');
    showToast(`Глава «${newChapter.title}» нормализована (JSON + FTS5) и добавлена в книгу!`);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F8F6F1] text-slate-900 pb-20 md:pb-0">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-8 px-6 py-3.5 bg-[#F8F6F1]/95 backdrop-blur-md border-b border-stone-200/80">
        {/* Zone 1: Brand icon + wordmark */}
        <button
          onClick={() => setActiveSection('library')}
          className="flex items-center gap-3 text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 font-display text-left"
        >
          <img
            src="/icon.svg"
            alt="Иконка приложения"
            referrerPolicy="no-referrer"
            className="w-9 h-9 rounded-xl shadow-xs shrink-0"
          />
          <span>Интерактивная Читалка</span>
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
            onClick={() => handleStartQuiz(activeBookId, currentChapter.id)}
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
            onClick={handleDownloadApk}
            disabled={isDownloadingApk}
            className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 flex items-center gap-2 min-h-[40px]"
          >
            <Download className="w-4 h-4" />
            <span>
              {isDownloadingApk
                ? 'Загрузка APK...'
                : `Скачать InteractiveReader.apk${
                    apkVerifiedBytes ? ` (${Math.round(apkVerifiedBytes / 1024)} КБ)` : ''
                  }`}
            </span>
          </button>
        </div>
      </header>

      {/* Offline Banner */}
      {!isOnline && (
        <div className="bg-amber-900 text-amber-50 px-6 py-2 text-xs font-medium text-center">
          Автономный офлайн-режим · Обе книги («Простые благодеяния» и «Психология: исламский дискурс», {totalCatalogChaptersCount} глав, {totalCatalogQuestionsCount} вопросов) доступны локально
        </div>
      )}

      {/* Toast Notification (LibraryEffect.ShowToast) */}
      {toastMessage && (
        <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white px-5 py-3 rounded-xl shadow-lg text-xs sm:text-sm font-medium flex items-center gap-2.5 border border-slate-700">
          <Lock className="w-4 h-4 text-amber-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* SECTION 1: MULTI-BOOK LIBRARY CATALOG (LibraryCatalogScreen) */}
        {activeSection === 'library' && (
          <div className="space-y-7">
            {/* Header & SearchBar */}
            <div className="bg-white rounded-2xl border border-stone-200/90 p-6 sm:p-7 shadow-xs space-y-5">
              <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
                <div className="space-y-1.5">
                  <div className="text-xs text-stone-500 font-mono-tabular">
                    Каталог библиотеки · 2 книги · {totalCatalogChaptersCount} глав · {totalCatalogQuestionsCount} вопросов · Каскадная разблокировка
                  </div>
                  <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 font-display">
                    Библиотека интерактивного чтения
                  </h1>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-xs text-stone-500">
                  <button
                    onClick={() => {
                      setArchitectBookId(activeBookId);
                      setArchitectChapterId(currentChapter.id);
                      setArchitectMode('inspect');
                      setIsArchitectOpen(true);
                    }}
                    className="px-3.5 py-2 rounded-xl bg-amber-900 text-amber-50 hover:bg-amber-800 font-semibold transition-colors flex items-center gap-2 shadow-xs"
                  >
                    <FileCode2 className="w-4 h-4" />
                    <span>Контент-архитектор глав (JSON / FTS5 / BiDi)</span>
                  </button>
                  <button
                    onClick={handleResetCatalogProgress}
                    className="hover:text-slate-900 underline underline-offset-4 font-medium transition-colors"
                  >
                    Сбросить прогресс всех книг
                  </button>
                </div>
              </div>

              {/* SearchBar / OutlinedTextField with Clear Button and 300ms Debounce */}
              <div className="relative">
                <Search className="w-4 h-4 text-stone-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Поиск FTS5 по книгам, главам и корням (RU ё=е / AR без огласовок: нафс, фитра, Таки Усмани, الحمد لله)..."
                  className="w-full pl-11 pr-11 py-3 bg-[#F8F6F1] border border-stone-300 rounded-xl text-sm text-slate-900 placeholder:text-stone-400 focus:outline-none focus:border-slate-900 transition-colors"
                />
                {searchInput.length > 0 && (
                  <button
                    onClick={() => setSearchInput('')}
                    aria-label="Очистить поиск"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 min-h-[36px] min-w-[36px] flex items-center justify-center text-stone-500 hover:text-slate-900 rounded-lg"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Book Card + Interactive Chapters Catalog */}
            {booksWithProgress.map((item) => {
              const percent = Math.round(item.progressRatio * 100);
              const q = normalizeForFts5(debouncedQuery);
              const bookMatches =
                !q ||
                normalizeForFts5(item.book.title).includes(q) ||
                normalizeForFts5(item.book.author).includes(q) ||
                normalizeForFts5(item.book.description).includes(q);
              const matchingChapters = !q || bookMatches
                ? item.chapters
                : item.chapters.filter(
                    (ch) =>
                      normalizeForFts5(ch.title).includes(q) ||
                      normalizeForFts5(ch.content).includes(q)
                  );

              if (q && !bookMatches && matchingChapters.length === 0) {
                return null;
              }

              return (
                <div key={item.book.id} className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                  {/* Left Column: Book Poster Card */}
                  <div
                    onClick={() => setSelectedBookIdForSheet(item.book.id)}
                    className="lg:col-span-4 bg-white rounded-2xl border border-stone-200/90 hover:border-stone-300 p-5 flex flex-col justify-between cursor-pointer transition-all hover:shadow-sm group"
                  >
                    <div className="space-y-4">
                      <BookCoverPoster book={item.book} />

                      <div className="space-y-1.5">
                        <div className="text-[11px] text-stone-500 font-mono-tabular">
                          {item.book.genre} · {item.book.year}
                        </div>
                        <h2 className="text-xl font-bold text-slate-900 font-display group-hover:text-amber-900 transition-colors">
                          {item.book.title}
                        </h2>
                        <p className="text-xs font-medium text-stone-600">{item.book.author}</p>
                      </div>

                      <p className="text-xs text-stone-600 leading-relaxed">
                        {item.book.description}
                      </p>
                    </div>

                    <div className="pt-4 mt-4 border-t border-stone-100 space-y-2.5">
                      <div className="flex items-center justify-between text-xs font-mono-tabular">
                        <span className="text-stone-600">Общий прогресс</span>
                        <span className="font-semibold text-slate-900">
                          {item.completedChaptersCount} / {item.totalChaptersCount} глав ({percent}%)
                        </span>
                      </div>
                      <div className="w-full h-2 bg-stone-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-700 transition-all duration-300 rounded-full"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                      <div className="pt-1 flex items-center justify-between text-xs font-semibold text-slate-900">
                        <span>Открыть карточку книги</span>
                        <ChevronRight className="w-4 h-4 text-stone-400 group-hover:translate-x-0.5 transition-transform" />
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Interactive Table of Contents & Quizzes */}
                  <div className="lg:col-span-8 bg-white rounded-2xl border border-stone-200/90 p-5 sm:p-6 shadow-xs space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 pb-3">
                      <div>
                        <h2 className="text-lg sm:text-xl font-bold text-slate-900 font-display">
                          Оглавление книги и проверочные тесты
                        </h2>
                        <p className="text-xs text-stone-500 mt-0.5">
                          Нажмите на доступную главу для чтения. Следующая часть открывается после сдачи теста минимум на 75%.
                        </p>
                      </div>
                      <div className="flex items-center gap-2.5 shrink-0">
                        <button
                          onClick={() => {
                            setArchitectBookId(item.book.id);
                            setArchitectChapterId(item.chapters[0]?.id || 501);
                            setRawBookSlug(
                              item.book.id === 5
                                ? 'prostye-blagodeyaniya'
                                : 'psihologiya-islamskiy-diskurs'
                            );
                            setRawChapterNumber(item.chapters.length + 1);
                            setArchitectMode('create_raw');
                            setIsArchitectOpen(true);
                          }}
                          className="px-3 py-1.5 rounded-lg border border-amber-800/30 bg-amber-50/80 hover:bg-amber-100 text-amber-950 text-xs font-semibold transition-colors flex items-center gap-1.5"
                        >
                          <FileCode2 className="w-3.5 h-3.5" />
                          <span>+ Добавить главу (JSON)</span>
                        </button>
                        <span className="text-xs font-mono-tabular font-semibold text-stone-600">
                          {matchingChapters.length} из {item.chapters.length} глав
                        </span>
                      </div>
                    </div>

                    {matchingChapters.length === 0 ? (
                      <div className="p-8 text-center space-y-2">
                        <p className="text-sm font-medium text-slate-800">
                          По запросу «{debouncedQuery}» главы не найдены
                        </p>
                        <button
                          onClick={() => setSearchInput('')}
                          className="px-3.5 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold"
                        >
                          Сбросить поиск
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {matchingChapters.map((ch) => {
                          const isLocked = ch.status === 'LOCKED';
                          const isPassed = ch.status === 'PASSED';

                          return (
                            <button
                              key={ch.id}
                              onClick={() => handleChapterClicked(item.book.id, ch)}
                              className={`w-full text-left p-4 rounded-xl border transition-all flex items-center justify-between gap-4 min-h-[64px] ${
                                isLocked
                                  ? 'bg-stone-100/80 border-stone-200/80 opacity-65'
                                  : 'bg-[#F8F6F1] border-stone-200/90 hover:border-slate-900'
                              }`}
                            >
                              <div className="flex items-center gap-3.5 min-w-0">
                                <div
                                  className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                                    isPassed
                                      ? 'bg-emerald-100 text-emerald-700'
                                      : isLocked
                                      ? 'bg-stone-200 text-stone-500'
                                      : 'bg-slate-900 text-white'
                                  }`}
                                >
                                  {isPassed ? (
                                    <CheckCircle2 className="w-5 h-5" />
                                  ) : isLocked ? (
                                    <Lock className="w-4 h-4" />
                                  ) : (
                                    <Play className="w-4 h-4 fill-current" />
                                  )}
                                </div>

                                <div className="min-w-0">
                                  <div className="text-sm font-bold text-slate-900 truncate">
                                    {ch.title}
                                  </div>
                                  <div className="text-xs text-stone-500 font-mono-tabular mt-0.5">
                                    {isPassed
                                      ? `Пройдено · Тест сдан на ${ch.score}% (${ch.quiz.length} вопроса)`
                                      : isLocked
                                      ? 'Заблокировано · Сначала пройдите предыдущую главу и тест'
                                      : ch.lastCharOffset > 0
                                      ? `Доступно · Продолжить чтение (смещение ${ch.lastCharOffset} симв.)`
                                      : `Доступно для чтения · ${ch.quiz.length} вопроса в тесте`}
                                  </div>
                                </div>
                              </div>

                              <ChevronRight className="w-4 h-4 text-stone-400 shrink-0" />
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* SECTION 2: READER */}
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
              {isControlsVisible && (
                <div
                  style={{
                    backgroundColor: activeTheme.surfaceHex,
                    borderColor: activeTheme.borderHex,
                  }}
                  className="px-4 sm:px-6 py-3 border-b flex items-center justify-between gap-4 z-20"
                >
                  <button
                    onClick={() => {
                      setSelectedBookIdForSheet(activeBookId);
                      setActiveSection('library');
                    }}
                    className="min-h-[44px] min-w-[44px] flex items-center gap-2 text-sm font-medium rounded-lg px-2 hover:opacity-80 transition-opacity"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span className="hidden sm:inline">{activeBookEntry.book.title}</span>
                  </button>

                  <div className="text-center truncate">
                    <div className="text-sm font-semibold truncate">{currentChapter.title}</div>
                    <div
                      style={{ color: activeTheme.mutedHex }}
                      className="text-[11px] font-mono-tabular"
                    >
                      Края экрана — листание · Центр — скрыть панели
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        setArchitectBookId(activeBookId);
                        setArchitectChapterId(currentChapter.id);
                        setArchitectMode('inspect');
                        setIsArchitectOpen(true);
                      }}
                      className="min-h-[40px] px-2.5 rounded-lg border border-current/20 text-xs font-mono-tabular font-semibold flex items-center gap-1.5 hover:opacity-80 transition-opacity"
                      title="Нормализованный JSON главы (Room FTS5 / BiDi / Сноски)"
                    >
                      <FileCode2 className="w-4 h-4" />
                      <span className="hidden sm:inline">JSON / FTS5</span>
                    </button>
                    <button
                      onClick={() => setIsSettingsSheetOpen((prev) => !prev)}
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:opacity-80 transition-opacity"
                      aria-label="Настройки чтения"
                    >
                      <Settings className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              )}

              <div
                onClick={handleReaderSurfaceClick}
                className="flex-1 px-6 sm:px-10 py-6 flex flex-col justify-between cursor-pointer relative"
              >
                <div
                  style={{
                    fontSize: `${settings.fontSizeSp}px`,
                    lineHeight: Math.max(1.55, settings.arabicScaleFactor * 1.38),
                  }}
                  className="font-reader tracking-normal my-auto"
                >
                  {currentPage?.text
                    ? currentPage.text.split('\n').map((lineText, lineIdx) => {
                        const isRtlLine = isArabicParagraphLine(lineText);
                        if (!lineText.trim()) {
                          return <div key={lineIdx} className="h-3" />;
                        }
                        return (
                          <div
                            key={lineIdx}
                            dir={isRtlLine ? 'rtl' : 'ltr'}
                            className={isRtlLine ? 'text-right' : 'text-left'}
                          >
                            {lineText.split(/([¹²³⁴⁵⁶⁷⁸⁹⁰]+)/g).map((part, idx) => {
                              const supMap: Record<string, string> = {
                                '¹': '1',
                                '²': '2',
                                '³': '3',
                                '⁴': '4',
                                '⁵': '5',
                                '⁶': '6',
                                '⁷': '7',
                                '⁸': '8',
                                '⁹': '9',
                                '⁰': '0',
                              };
                              if (/^[¹²³⁴⁵⁶⁷⁸⁹⁰]+$/.test(part)) {
                                const fnId = part
                                  .split('')
                                  .map((c) => supMap[c] || c)
                                  .join('');
                                const fnObj = currentReaderNormalizedDoc.footnotes.find(
                                  (f) => f.id === fnId
                                );
                                if (fnObj) {
                                  return (
                                    <button
                                      key={idx}
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setActiveFootnotePopup(fnObj);
                                      }}
                                      title={`Сноска ${fnId}: ${fnObj.anchor_text}`}
                                      className="inline-flex items-center justify-center px-1.5 py-0.5 mx-0.5 text-[11px] font-mono-tabular font-bold rounded bg-amber-500/20 text-amber-700 border border-amber-600/40 align-super hover:bg-amber-500/30 transition-colors cursor-pointer"
                                    >
                                      {part}
                                    </button>
                                  );
                                }
                              }
                              return (
                                <React.Fragment key={idx}>
                                  {renderMixedArabicFragment(
                                    part,
                                    settings.fontSizeSp,
                                    settings.arabicScaleFactor,
                                    `p-${lineIdx}-${idx}`
                                  )}
                                </React.Fragment>
                              );
                            })}
                          </div>
                        );
                      })
                    : null}
                </div>

                {activeFootnotePopup && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      backgroundColor: activeTheme.surfaceHex,
                      borderColor: activeTheme.borderHex,
                    }}
                    className="mt-3 p-3.5 rounded-xl border shadow-sm space-y-1.5 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono-tabular font-bold text-amber-700">
                        Сноска [{activeFootnotePopup.id}] · Привязка: {activeFootnotePopup.anchor_text}
                      </span>
                      <button
                        type="button"
                        onClick={() => setActiveFootnotePopup(null)}
                        className="p-1 rounded hover:opacity-75"
                        aria-label="Закрыть сноску"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="leading-relaxed font-reader text-sm space-y-1">
                      {(activeFootnotePopup.text || '').split('\n').map((fnLine, fnIdx) => {
                        const isRtlFn = isArabicParagraphLine(fnLine);
                        return (
                          <div
                            key={fnIdx}
                            dir={isRtlFn ? 'rtl' : 'ltr'}
                            className={isRtlFn ? 'text-right' : 'text-left'}
                          >
                            {renderMixedArabicFragment(
                              fnLine,
                              14,
                              settings.arabicScaleFactor,
                              `fn-${fnIdx}`
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

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
                    Стр. {currentPageIndex + 1} / {pages.length}
                  </div>

                  {isLastReaderPage && (
                    <button
                      onClick={() => handleStartQuiz(activeBookId, currentChapter.id)}
                      className="px-4 py-2.5 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-xs font-semibold flex items-center gap-2 min-h-[44px] shadow-xs transition-colors"
                    >
                      <span>Пройти тест</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

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
                    <h3 className="text-base font-bold">Настройки чтения</h3>
                    <button
                      onClick={() => setIsSettingsSheetOpen(false)}
                      className="text-xs font-medium underline min-h-[36px] px-2"
                    >
                      Готово
                    </button>
                  </div>

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

                  <div className="space-y-2 pt-1">
                    <div className="flex items-center justify-between text-xs font-medium">
                      <span>
                        Масштаб арабской вязи:{' '}
                        <strong className="font-mono-tabular">
                          {settings.arabicScaleFactor.toFixed(2)}x (
                          {(settings.fontSizeSp * settings.arabicScaleFactor).toFixed(1)} sp)
                        </strong>
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setSettings((s) => ({ ...s, arabicScaleFactor: 1.0 }))
                        }
                        className="px-2 py-0.5 rounded border border-current/20 text-[11px] font-mono-tabular hover:opacity-80"
                      >
                        Сброс 1.0x
                      </button>
                    </div>
                    <input
                      type="range"
                      min={1.0}
                      max={2.0}
                      step={0.05}
                      value={settings.arabicScaleFactor}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          arabicScaleFactor: Math.min(
                            2.0,
                            Math.max(1.0, parseFloat(e.target.value) || 1.0)
                          ),
                        }))
                      }
                      className="w-full accent-amber-700 cursor-pointer"
                    />
                  </div>

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
                          className="min-h-[48px] rounded-xl border-2 text-xs font-semibold flex items-center justify-center gap-2"
                        >
                          {isSelected && <Check className="w-3.5 h-3.5 text-amber-700" />}
                          <span>{t.displayName}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* SECTION 3: QUIZ */}
        {activeSection === 'quiz' && (
          <div className="max-w-2xl mx-auto">
            <div className="bg-white rounded-2xl border border-stone-200/90 p-6 sm:p-8 shadow-xs">
              {!isQuizCompleted && currentQuestion ? (
                <div className="space-y-6">
                  <div className="flex items-center justify-between gap-4 border-b border-stone-100 pb-4">
                    <div>
                      <div className="text-xs text-stone-500 font-mono-tabular">
                        {activeBookEntry.book.title} · {currentChapter.title}
                      </div>
                      <h2 className="text-xl font-bold text-slate-900 font-display mt-0.5">
                        Вопрос {quizQuestionIndex + 1} из {currentChapter.quiz.length}
                      </h2>
                    </div>
                    <div className="text-xs font-mono-tabular font-semibold text-stone-600">
                      Верных: {correctAnswersCount}
                    </div>
                  </div>

                  <div className="w-full h-2 bg-stone-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-slate-900 transition-all duration-300"
                      style={{
                        width: `${Math.round(
                          ((quizQuestionIndex + 1) / currentChapter.quiz.length) * 100
                        )}%`,
                      }}
                    />
                  </div>

                  <h3 className="text-lg sm:text-xl font-semibold text-slate-900 leading-snug">
                    {currentQuestion.question}
                  </h3>

                  <div className="space-y-3">
                    {currentQuestion.options.map((optText, idx) => {
                      const isSelected = selectedOptionIndex === idx;
                      const isCorrectOption = idx === currentQuestion.correctAnswerIndex;

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

                  {isAnswerSubmitted && (
                    <div className="rounded-xl bg-amber-50/90 border border-amber-200 p-4 flex items-start gap-3 text-amber-950">
                      <Info className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                      <div className="space-y-1 text-sm">
                        <div className="font-semibold">Пояснение</div>
                        <p className="text-amber-900/90 leading-relaxed">
                          {currentQuestion.explanation}
                        </p>
                      </div>
                    </div>
                  )}

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
                          {quizQuestionIndex + 1 < currentChapter.quiz.length
                            ? 'Следующий вопрос'
                            : 'Завершить тест'}
                        </span>
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ) : (
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
                      Правильных ответов: {correctAnswersCount} из {currentChapter.quiz.length}.{' '}
                      {isQuizPassed
                        ? nextChapterObj
                          ? `Следующая глава («${nextChapterObj.title}») разблокирована!`
                          : `Вы завершили все главы книги «${activeBookEntry.book.title}»!`
                        : `Для разблокировки следующей главы необходимо набрать минимум ${PASSING_SCORE_PERCENT}%.`}
                    </p>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
                    {isQuizPassed ? (
                      <>
                        {nextChapterObj ? (
                          <button
                            onClick={() =>
                              handleChapterClicked(activeBookId, {
                                ...nextChapterObj,
                                status: 'AVAILABLE',
                                lastCharOffset: 0,
                              })
                            }
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
                      </>
                    ) : (
                      <button
                        onClick={() => setActiveSection('reader')}
                        className="w-full sm:w-auto px-6 py-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold flex items-center justify-center gap-2 min-h-[48px]"
                      >
                        <BookOpen className="w-4 h-4" />
                        <span>Перечитать главу</span>
                      </button>
                    )}

                    <button
                      onClick={() => handleStartQuiz(activeBookId, currentChapter.id)}
                      className="w-full sm:w-auto px-5 py-3.5 rounded-xl border border-stone-300 text-slate-800 hover:bg-stone-100 text-sm font-semibold flex items-center justify-center gap-2 min-h-[48px]"
                    >
                      <RotateCcw className="w-4 h-4" />
                      <span>Повторить тест</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* SECTION 4: APK EXPORT */}
        {activeSection === 'apk' && (
          <div className="space-y-8">
            <div className="bg-white rounded-2xl border border-stone-200/90 p-6 sm:p-8 shadow-xs space-y-6">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 border-b border-stone-100 pb-6">
                <div className="flex items-start sm:items-center gap-5 max-w-2xl">
                  <img
                    src="/icon.svg"
                    alt="Иконка Android-приложения"
                    referrerPolicy="no-referrer"
                    className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl shadow-md border border-amber-500/30 shrink-0"
                  />
                  <div className="space-y-2">
                    <div className="text-xs text-stone-500 font-mono-tabular">
                      Kotlin 2.0.21 · Target SDK 35 · Room 2.6.1 · 2 книги ({totalCatalogChaptersCount} глав, {totalCatalogQuestionsCount} вопросов) · Иконка ic_launcher
                    </div>
                    <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 font-display">
                      Скачивание готового APK и исходного проекта Android Studio
                    </h1>
                    <p className="text-sm text-stone-600 leading-relaxed">
                      Скачайте подписанный установочный файл{' '}
                      <code className="font-mono-tabular">InteractiveReader.apk</code> с фирменной
                      иконкой полумесяца и чёток напрямую на смартфон или архив проекта с исходным кодом.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 shrink-0">
                  <button
                    onClick={handleDownloadApk}
                    disabled={isDownloadingApk}
                    className="px-5 py-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold flex items-center gap-2.5 min-h-[48px] shadow-xs transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    <span>
                      {isDownloadingApk
                        ? 'Скачивание APK...'
                        : `Скачать InteractiveReader.apk (${
                            apkVerifiedBytes ? `${Math.round(apkVerifiedBytes / 1024)} КБ` : 'Готов'
                          })`}
                    </span>
                  </button>
                  <button
                    onClick={handleDownloadZip}
                    disabled={isDownloadingZip}
                    className="px-5 py-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold flex items-center gap-2.5 min-h-[48px] shadow-xs transition-colors"
                  >
                    <FileCode2 className="w-4 h-4" />
                    <span>
                      {isDownloadingZip
                        ? 'Упаковка архива...'
                        : 'Скачать Android Studio проект (.zip)'}
                    </span>
                  </button>
                </div>
              </div>

              <div className="pt-2 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-slate-900 font-display">
                    Инспектор файлов проекта ({projectFiles.length})
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
                  <div className="lg:col-span-4 space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
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

                  <div className="lg:col-span-8 bg-slate-950 text-slate-100 rounded-xl p-4 overflow-x-auto max-h-[420px]">
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

      {/* BookDetailsBottomSheet (ModalBottomSheet equivalent) */}
      {selectedBookDetails && (
        <div
          onClick={() => setSelectedBookIdForSheet(null)}
          className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white w-full max-w-2xl rounded-t-3xl sm:rounded-2xl max-h-[88vh] flex flex-col overflow-hidden shadow-2xl border border-stone-200"
          >
            {/* Drag handle */}
            <div className="w-10 h-1.5 bg-stone-300 rounded-full mx-auto mt-3 sm:hidden" />

            {/* Sheet Header: Poster, Title, Author, Full Scrollable Description */}
            <div className="p-6 border-b border-stone-100 flex flex-col sm:flex-row gap-5 items-start">
              <div className="w-24 sm:w-28 shrink-0 mx-auto sm:mx-0">
                <BookCoverPoster book={selectedBookDetails.book} />
              </div>

              <div className="flex-1 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs text-stone-500 font-mono-tabular">
                      {selectedBookDetails.book.genre} · {selectedBookDetails.book.year}
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900 font-display">
                      {selectedBookDetails.book.title}
                    </h2>
                    <p className="text-sm font-medium text-stone-600">
                      {selectedBookDetails.book.author}
                    </p>
                  </div>
                  <button
                    onClick={() => setSelectedBookIdForSheet(null)}
                    aria-label="Закрыть шторку"
                    className="min-h-[38px] min-w-[38px] rounded-full hover:bg-stone-100 flex items-center justify-center text-stone-500"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <p className="text-xs sm:text-sm text-stone-600 leading-relaxed max-h-28 overflow-y-auto pr-1">
                  {selectedBookDetails.book.description}
                </p>

                <div className="pt-1 flex items-center justify-between text-xs font-mono-tabular">
                  <span className="text-stone-500">Прогресс чтения книги</span>
                  <span className="font-semibold text-slate-900">
                    {selectedBookDetails.completedChaptersCount} /{' '}
                    {selectedBookDetails.totalChaptersCount} глав (
                    {Math.round(selectedBookDetails.progressRatio * 100)}%)
                  </span>
                </div>
              </div>
            </div>

            {/* Chapters List (LazyColumn with PASSED / AVAILABLE / LOCKED statuses) */}
            <div className="flex-1 overflow-y-auto p-6 space-y-3">
              <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider">
                Оглавление ({selectedBookDetails.chapters.length}{' '}
                {selectedBookDetails.chapters.length >= 5 ? 'глав' : 'главы'})
              </div>

              {selectedBookDetails.chapters.map((ch) => {
                const isLocked = ch.status === 'LOCKED';
                const isPassed = ch.status === 'PASSED';

                return (
                  <button
                    key={ch.id}
                    onClick={() => handleChapterClicked(selectedBookDetails.book.id, ch)}
                    className={`w-full text-left p-4 rounded-xl border transition-all flex items-center justify-between gap-4 min-h-[64px] ${
                      isLocked
                        ? 'bg-stone-100/80 border-stone-200/80 opacity-65'
                        : 'bg-[#F8F6F1] border-stone-200/90 hover:border-slate-900'
                    }`}
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                          isPassed
                            ? 'bg-emerald-100 text-emerald-700'
                            : isLocked
                            ? 'bg-stone-200 text-stone-500'
                            : 'bg-slate-900 text-white'
                        }`}
                      >
                        {isPassed ? (
                          <CheckCircle2 className="w-5 h-5" />
                        ) : isLocked ? (
                          <Lock className="w-4 h-4" />
                        ) : (
                          <Play className="w-4 h-4 fill-current" />
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="text-sm font-bold text-slate-900 truncate">{ch.title}</div>
                        <div className="text-xs text-stone-500 font-mono-tabular mt-0.5">
                          {isPassed
                            ? `Пройдено · Тест сдан на ${ch.score}%`
                            : isLocked
                            ? 'Заблокировано · Сначала пройдите предыдущую главу и тест'
                            : ch.lastCharOffset > 0
                            ? `Доступно · Смещение ${ch.lastCharOffset} симв.`
                            : 'Доступно для чтения'}
                        </div>
                      </div>
                    </div>

                    <ChevronRight className="w-4 h-4 text-stone-400 shrink-0" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Content-Architect Modal (Jetpack Compose / Room FTS5 / Kotlinx Serialization JSON Pipeline) */}
      {isArchitectOpen && (
        <div
          onClick={() => setIsArchitectOpen(false)}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white w-full max-w-6xl rounded-2xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl border border-stone-200"
          >
            {/* Header */}
            <div className="px-5 sm:px-6 py-4 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-mono-tabular text-amber-400">
                  Jetpack Compose · Room FTS5 · Kotlinx Serialization / Moshi · BiDi (\u2067...\u2069)
                </div>
                <h2 className="text-lg sm:text-xl font-bold font-display">
                  Контент-архитектор и проверка добавления глав (RU / EN / AR)
                </h2>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setArchitectMode('inspect')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    architectMode === 'inspect'
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-slate-800 text-stone-200 hover:bg-slate-700'
                  }`}
                >
                  Инспектор глав
                </button>
                <button
                  onClick={() => {
                    setRawBookSlug(
                      architectBookId === 5
                        ? 'prostye-blagodeyaniya'
                        : 'psihologiya-islamskiy-diskurs'
                    );
                    setRawChapterNumber(architectBookEntry.chapters.length + 1);
                    setArchitectMode('create_raw');
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    architectMode === 'create_raw'
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-slate-800 text-stone-200 hover:bg-slate-700'
                  }`}
                >
                  + Из сырого текста (Raw → JSON)
                </button>
                <button
                  onClick={() => {
                    if (!jsonInputText.trim()) {
                      setJsonInputText(JSON.stringify(architectDocumentResult.doc, null, 2));
                    }
                    setArchitectMode('create_json');
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    architectMode === 'create_json'
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-slate-800 text-stone-200 hover:bg-slate-700'
                  }`}
                >
                  + Из JSON схемы
                </button>
                <button
                  onClick={() => setIsArchitectOpen(false)}
                  aria-label="Закрыть"
                  className="ml-2 p-1.5 rounded-lg hover:bg-slate-800 text-stone-300"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6 bg-[#F8F6F1]">
              {/* Top Controls: Select Book / Chapter or Input Raw Params */}
              {architectMode === 'inspect' && (
                <div className="bg-white rounded-xl border border-stone-200 p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-stone-600 mb-1.5">
                      Книга библиотеки (`book_id`)
                    </label>
                    <select
                      value={architectBookId}
                      onChange={(e) => {
                        const newBookId = Number(e.target.value);
                        setArchitectBookId(newBookId);
                        const found = booksWithProgress.find((b) => b.book.id === newBookId);
                        if (found && found.chapters[0]) {
                          setArchitectChapterId(found.chapters[0].id);
                        }
                      }}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-stone-300 bg-[#F8F6F1] text-sm font-medium text-slate-900"
                    >
                      {booksWithProgress.map((b) => (
                        <option key={b.book.id} value={b.book.id}>
                          {b.book.title} ({b.chapters.length} глав)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-stone-600 mb-1.5">
                      Глава для проверки нормализации JSON и FTS5
                    </label>
                    <select
                      value={architectChapterId}
                      onChange={(e) => setArchitectChapterId(Number(e.target.value))}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-stone-300 bg-[#F8F6F1] text-sm font-medium text-slate-900"
                    >
                      {architectBookEntry.chapters.map((ch) => (
                        <option key={ch.id} value={ch.id}>
                          Глава {ch.chapterOrder}: {ch.title}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {architectMode === 'create_raw' && (
                <div className="bg-white rounded-xl border border-stone-200 p-4 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        Входные параметры Контент-архитектора (`book_id`, `chapter_number`, `chunk_info`, `raw_content`)
                      </h3>
                      <p className="text-xs text-stone-500">
                        Автоматическая очистка OCR-переносов, кавычек «...», BiDi изолятов `\u2067...\u2069`, сносок `&#123;&#123;fn:ID&#125;&#125;`, бейтов `sadr || ajuz` и генерация `search_text` для Room FTS5.
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setRawChapterTitle(
                          'Глава 13. Достоинство чтения салаватов и зикра (RU / AR / FTS5)'
                        );
                        setRawInputText(DEMO_RAW_CHAPTER_INPUT);
                      }}
                      className="px-3 py-1.5 rounded-lg border border-stone-300 text-xs font-semibold text-slate-700 hover:bg-stone-100"
                    >
                      Загрузить эталонный пример (RU + AR + Бейт + Словарь + Сноски)
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                        Книга назначения
                      </label>
                      <select
                        value={architectBookId}
                        onChange={(e) => {
                          const id = Number(e.target.value);
                          setArchitectBookId(id);
                          setRawBookSlug(
                            id === 5 ? 'prostye-blagodeyaniya' : 'psihologiya-islamskiy-diskurs'
                          );
                        }}
                        className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-[#F8F6F1] text-xs font-medium"
                      >
                        {booksWithProgress.map((b) => (
                          <option key={b.book.id} value={b.book.id}>
                            {b.book.title}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                        `book_id` (slug/uuid)
                      </label>
                      <input
                        type="text"
                        value={rawBookSlug}
                        onChange={(e) => setRawBookSlug(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-[#F8F6F1] text-xs font-mono-tabular"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                        `chapter_number`
                      </label>
                      <input
                        type="number"
                        value={rawChapterNumber}
                        onChange={(e) => setRawChapterNumber(Number(e.target.value) || 1)}
                        className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-[#F8F6F1] text-xs font-mono-tabular"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                        `chunk_info`
                      </label>
                      <input
                        type="text"
                        value={rawChunkInfo}
                        onChange={(e) => setRawChunkInfo(e.target.value)}
                        placeholder="часть 1 из 3"
                        className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-[#F8F6F1] text-xs font-mono-tabular"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                      Заголовок главы (`title.ru`)
                    </label>
                    <input
                      type="text"
                      value={rawChapterTitle}
                      onChange={(e) => setRawChapterTitle(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-[#F8F6F1] text-xs font-medium"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-stone-600 mb-1">
                      `raw_content` (поддерживаются сноски `[1]` или `&#123;&#123;fn:fn_1&#125;&#125;`, бейты через `||`, словарь `Слово — перевод`, арабский текст с огласовками)
                    </label>
                    <textarea
                      rows={6}
                      value={rawInputText}
                      onChange={(e) => setRawInputText(e.target.value)}
                      className="w-full p-3 rounded-xl border border-stone-300 bg-[#F8F6F1] text-xs font-mono-tabular leading-relaxed"
                    />
                  </div>

                  <div className="flex justify-end">
                    <button
                      onClick={handleAddNormalizedChapterToBook}
                      className="px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold flex items-center gap-2 shadow-xs"
                    >
                      <Check className="w-4 h-4" />
                      <span>Нормализовать и добавить главу в книгу «{architectBookEntry.book.title}»</span>
                    </button>
                  </div>
                </div>
              )}

              {architectMode === 'create_json' && (
                <div className="bg-white rounded-xl border border-stone-200 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        Прямой импорт и валидация JSON (Kotlinx Serialization / Moshi)
                      </h3>
                      <p className="text-xs text-stone-500">
                        Вставьте JSON-объект по схеме промта (`book_id`, `chapter_number`, `chunk_meta`, `title`, `blocks`, `footnotes`).
                      </p>
                    </div>
                    {architectDocumentResult.error ? (
                      <span className="px-2.5 py-1 rounded-md bg-rose-100 text-rose-800 text-xs font-semibold">
                        {architectDocumentResult.error}
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 rounded-md bg-emerald-100 text-emerald-800 text-xs font-semibold">
                        Валидный JSON
                      </span>
                    )}
                  </div>

                  <textarea
                    rows={8}
                    value={jsonInputText}
                    onChange={(e) => setJsonInputText(e.target.value)}
                    className="w-full p-3 rounded-xl border border-stone-300 bg-slate-950 text-emerald-300 text-xs font-mono-tabular leading-relaxed"
                  />

                  <div className="flex justify-end">
                    <button
                      onClick={handleAddNormalizedChapterToBook}
                      disabled={Boolean(architectDocumentResult.error)}
                      className="px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-2 shadow-xs"
                    >
                      <Check className="w-4 h-4" />
                      <span>Импортировать JSON как новую главу в «{architectBookEntry.book.title}»</span>
                    </button>
                  </div>
                </div>
              )}

              {/* 5-Point Prompt Verification Audit Report */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                {architectAudit.map((check) => (
                  <div
                    key={check.ruleNumber}
                    className="bg-white p-3.5 rounded-xl border border-stone-200 space-y-1"
                  >
                    <div
                      className={`flex items-center justify-between text-xs font-bold ${
                        check.passed ? 'text-emerald-800' : 'text-amber-800'
                      }`}
                    >
                      <span>
                        {check.ruleNumber}. {check.ruleTitle.split('(')[0].trim()}
                      </span>
                      <CheckCircle2
                        className={`w-4 h-4 shrink-0 ${
                          check.passed ? 'text-emerald-600' : 'text-amber-600'
                        }`}
                      />
                    </div>
                    <p className="text-[11px] text-stone-600 leading-snug">{check.details}</p>
                  </div>
                ))}
              </div>

              {/* Two-Column Inspector: Left = Interactive Blocks & Footnotes Preview, Right = Strict JSON Output */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                {/* Left: Rendered Jetpack Compose Block Preview */}
                <div className="lg:col-span-6 bg-white rounded-xl border border-stone-200 p-4 sm:p-5 space-y-4 max-h-[460px] overflow-y-auto">
                  <div className="flex items-center justify-between border-b border-stone-100 pb-2.5">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        Предпросмотр блоков Jetpack Compose (`AnnotatedString` + BiDi)
                      </h3>
                      <p className="text-[11px] text-stone-500">
                        Нажмите на маркер сноски `[fn]` для проверки `anchor_text` и `is_missing`
                      </p>
                    </div>
                    <span className="text-[11px] font-mono-tabular text-stone-500">
                      {architectDocumentResult.doc.blocks.length} блоков
                    </span>
                  </div>

                  {activeFootnotePopup && (
                    <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-xs space-y-1">
                      <div className="flex items-center justify-between font-bold text-amber-950">
                        <span>
                          Сноска `{activeFootnotePopup.id}` · Привязка (`anchor_text`): «{activeFootnotePopup.anchor_text}»
                        </span>
                        <button
                          onClick={() => setActiveFootnotePopup(null)}
                          className="text-amber-900 hover:underline text-[11px]"
                        >
                          Закрыть
                        </button>
                      </div>
                      <p className="text-amber-900">
                        {activeFootnotePopup.is_missing
                          ? 'Пояснение отсутствует в исходнике (text: null, is_missing: true)'
                          : activeFootnotePopup.text}
                      </p>
                    </div>
                  )}

                  <div className="space-y-3">
                    {architectDocumentResult.doc.blocks.map((block) => {
                      const isRtl = block.direction === 'rtl';
                      const blockRawContent = `${block.text || ''} ${block.sadr || ''} ${block.ajuz || ''}`;
                      return (
                        <div
                          key={block.id}
                          dir={isRtl ? 'rtl' : 'ltr'}
                          className={`p-3.5 rounded-xl border space-y-2 ${
                            isRtl
                              ? 'bg-amber-50/40 border-amber-200/80'
                              : 'bg-[#F8F6F1] border-stone-200/80'
                          }`}
                        >
                          <div
                            dir="ltr"
                            className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono-tabular text-stone-500 border-b border-stone-200/60 pb-1.5"
                          >
                            <span>
                              #{block.id} · `{block.type}` · lang=`{block.language}` · dir=`{block.direction}` · scale={block.typography.font_scale} · lh={block.typography.line_height_multiplier}
                            </span>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(block.copy_text);
                                showToast('Скопирован copy_text с атрибуцией книги и главы!');
                              }}
                              className="px-2 py-0.5 rounded bg-white border border-stone-300 text-slate-700 hover:bg-stone-100"
                            >
                              Копировать `copy_text`
                            </button>
                          </div>

                          {block.type === 'verse_pair' && block.sadr && block.ajuz ? (
                            <div
                              style={{
                                fontSize: `${Math.round(16 * (block.typography.font_scale || 1.25))}px`,
                                lineHeight: block.typography.line_height_multiplier || 1.6,
                              }}
                              className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-reader text-slate-900 py-1"
                            >
                              <div className="text-right pr-2 border-r border-amber-300">
                                <span className="block text-[10px] font-mono-tabular text-stone-400">
                                  sadr (1-е полустишие)
                                </span>
                                {block.sadr}
                              </div>
                              <div className="text-left pl-2">
                                <span className="block text-[10px] font-mono-tabular text-stone-400">
                                  ajuz (2-е полустишие)
                                </span>
                                {block.ajuz}
                              </div>
                            </div>
                          ) : block.type === 'vocabulary_item' && block.term ? (
                            <div className="flex flex-wrap items-baseline justify-between gap-3 py-1">
                              <span
                                dir="rtl"
                                style={{ fontSize: '20px', lineHeight: 1.6 }}
                                className="font-bold text-slate-900"
                              >
                                {block.term}
                              </span>
                              <span dir="ltr" className="text-xs font-medium text-stone-700">
                                — {block.morphology}
                              </span>
                            </div>
                          ) : (
                            <div
                              style={{
                                fontSize: `${Math.round(15 * (block.typography.font_scale || 1))}px`,
                                lineHeight: block.typography.line_height_multiplier || 1.5,
                              }}
                              className="font-reader text-slate-900 whitespace-pre-line"
                            >
                              {block.text}
                            </div>
                          )}

                          {/* Interactive footnote chips if present in block */}
                          {architectDocumentResult.doc.footnotes
                            .filter((fn) => blockRawContent.includes(`{{fn:${fn.id}}}`))
                            .map((fn) => (
                              <button
                                key={fn.id}
                                dir="ltr"
                                onClick={() => setActiveFootnotePopup(fn)}
                                className={`mr-1.5 mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono-tabular font-semibold ${
                                  fn.is_missing
                                    ? 'bg-rose-100 text-rose-800 border border-rose-300'
                                    : 'bg-amber-100 text-amber-950 border border-amber-300'
                                }`}
                              >
                                <span>{`{{fn:${fn.id}}}`}</span>
                                <span>→ «{fn.anchor_text}»</span>
                              </button>
                            ))}

                          <div
                            dir="ltr"
                            className="pt-1 text-[10px] font-mono-tabular text-stone-500 truncate"
                            title={block.search_text}
                          >
                            <span className="font-semibold text-stone-600">FTS5 search_text:</span>{' '}
                            {block.search_text}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Right: Strict Normalized JSON Output */}
                <div className="lg:col-span-6 bg-slate-950 text-slate-100 rounded-xl p-4 sm:p-5 flex flex-col max-h-[460px]">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2.5 mb-3">
                    <div>
                      <div className="text-xs font-mono-tabular text-amber-400 font-semibold">
                        NormalizedChapterDocument (Kotlinx Serialization / Moshi)
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Строго валидный JSON без markdown-оберток · Готов к Room FTS5
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(
                          JSON.stringify(architectDocumentResult.doc, null, 2)
                        );
                        setCopiedJsonBadge(true);
                        window.setTimeout(() => setCopiedJsonBadge(false), 1800);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-mono-tabular text-amber-300 flex items-center gap-1.5"
                    >
                      {copiedJsonBadge ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span>JSON скопирован</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Копировать JSON</span>
                        </>
                      )}
                    </button>
                  </div>

                  <pre className="flex-1 overflow-auto text-xs font-mono-tabular leading-relaxed text-emerald-300">
                    <code>{JSON.stringify(architectDocumentResult.doc, null, 2)}</code>
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Fixed Bottom Navigation Bar */}
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
          onClick={() => handleStartQuiz(activeBookId, currentChapter.id)}
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
    </div>
  );
}
