import type { ProjectFileItem } from './androidProjectBuilder';

export const ADDITIONAL_KOTLIN_FILES: ProjectFileItem[] = [
  {
    path: 'app/src/main/java/com/example/interactivereader/core/database/converter/RoomTypeConverters.kt',
    category: 'Core & Room DB',
    description: '@ProvidedTypeConverter для List<String> через kotlinx.serialization.json.Json',
    content: `package com.example.interactivereader.core.database.converter

import androidx.room.ProvidedTypeConverter
import androidx.room.TypeConverter
import com.example.interactivereader.core.domain.model.ChapterStatus
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

@ProvidedTypeConverter
@Singleton
class RoomTypeConverters @Inject constructor(
    private val json: Json
) {
    private val stringListSerializer = ListSerializer(String.serializer())

    @TypeConverter
    fun fromStringList(value: List<String>?): String {
        if (value.isNullOrEmpty()) return "[]"
        return json.encodeToString(stringListSerializer, value)
    }

    @TypeConverter
    fun toStringList(value: String?): List<String> {
        if (value.isNullOrBlank()) return emptyList()
        return json.decodeFromString(stringListSerializer, value)
    }

    @TypeConverter
    fun fromChapterStatus(status: ChapterStatus): String = status.name

    @TypeConverter
    fun toChapterStatus(value: String): ChapterStatus =
        runCatching { ChapterStatus.valueOf(value) }.getOrDefault(ChapterStatus.LOCKED)
}
`,
  },
  {
    path: 'app/src/main/java/com/example/interactivereader/core/database/dao/Daos.kt',
    category: 'Core & Room DB',
    description: 'BookDao, ChapterDao и ProgressDao с реактивными Flow и @Transaction методами',
    content: `package com.example.interactivereader.core.database.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import com.example.interactivereader.core.database.entity.BookEntity
import com.example.interactivereader.core.database.entity.ChapterEntity
import com.example.interactivereader.core.database.entity.ChapterProgressEntity
import com.example.interactivereader.core.database.entity.ChapterWithProgressRelation
import com.example.interactivereader.core.database.entity.QuizQuestionEntity
import com.example.interactivereader.core.domain.model.ChapterStatus
import kotlinx.coroutines.flow.Flow
import kotlin.math.max

@Dao
interface BookDao {
    @Query("SELECT * FROM books ORDER BY id ASC")
    fun observeAllBooks(): Flow<List<BookEntity>>

    @Query("SELECT * FROM books WHERE id = :bookId LIMIT 1")
    fun observeBookById(bookId: Long): Flow<BookEntity?>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertBook(book: BookEntity): Long
}

@Dao
interface ChapterDao {
    @Transaction
    @Query("SELECT id, bookId, chapterIndex, title FROM chapters WHERE bookId = :bookId ORDER BY chapterIndex ASC")
    fun observeChaptersWithProgressByBookId(bookId: Long): Flow<List<ChapterWithProgressRelation>>

    @Query("SELECT * FROM chapters WHERE id = :chapterId LIMIT 1")
    fun observeChapterById(chapterId: Long): Flow<ChapterEntity?>

    @Query("SELECT * FROM chapters WHERE id = :chapterId LIMIT 1")
    suspend fun getChapterById(chapterId: Long): ChapterEntity?

    @Query("SELECT * FROM chapters WHERE bookId = :bookId AND chapterIndex = :nextChapterIndex LIMIT 1")
    suspend fun getChapterByIndex(bookId: Long, nextChapterIndex: Int): ChapterEntity?

    @Query("SELECT * FROM quiz_questions WHERE chapterId = :chapterId ORDER BY id ASC")
    fun observeQuizQuestionsByChapterId(chapterId: Long): Flow<List<QuizQuestionEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertChapters(chapters: List<ChapterEntity>): List<Long>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertQuizQuestions(questions: List<QuizQuestionEntity>): List<Long>
}

@Dao
interface ProgressDao {
    @Query("SELECT * FROM chapter_progress WHERE bookId = :bookId AND chapterId = :chapterId LIMIT 1")
    suspend fun getProgress(bookId: Long, chapterId: Long): ChapterProgressEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertProgress(progress: ChapterProgressEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertProgressList(progressList: List<ChapterProgressEntity>)

    @Transaction
    suspend fun updateReadingOffsetTransactional(
        bookId: Long,
        chapterId: Long,
        lastCharOffset: Int,
        updatedAt: Long
    ) {
        val existing = getProgress(bookId, chapterId)
        if (existing != null) {
            upsertProgress(existing.copy(lastCharOffset = lastCharOffset, updatedAt = updatedAt))
        } else {
            upsertProgress(
                ChapterProgressEntity(
                    bookId = bookId,
                    chapterId = chapterId,
                    status = ChapterStatus.AVAILABLE,
                    lastCharOffset = lastCharOffset,
                    bestQuizScore = 0,
                    updatedAt = updatedAt
                )
            )
        }
    }

    @Transaction
    suspend fun completeChapterAndUnlockNextTransactional(
        bookId: Long,
        currentChapterId: Long,
        nextChapterId: Long?,
        quizScore: Int,
        updatedAt: Long
    ) {
        val currentProgress = getProgress(bookId, currentChapterId)
        val bestScore = if (currentProgress != null) max(currentProgress.bestQuizScore, quizScore) else quizScore

        upsertProgress(
            ChapterProgressEntity(
                bookId = bookId,
                chapterId = currentChapterId,
                status = ChapterStatus.PASSED,
                lastCharOffset = currentProgress?.lastCharOffset ?: 0,
                bestQuizScore = bestScore,
                updatedAt = updatedAt
            )
        )

        if (nextChapterId != null) {
            val nextProgress = getProgress(bookId, nextChapterId)
            if (nextProgress == null || nextProgress.status == ChapterStatus.LOCKED) {
                upsertProgress(
                    ChapterProgressEntity(
                        bookId = bookId,
                        chapterId = nextChapterId,
                        status = ChapterStatus.AVAILABLE,
                        lastCharOffset = nextProgress?.lastCharOffset ?: 0,
                        bestQuizScore = nextProgress?.bestQuizScore ?: 0,
                        updatedAt = updatedAt
                    )
                )
            }
        }
    }
}
`,
  },
  {
    path: 'app/src/main/java/com/example/interactivereader/feature_reader/domain/pagination/TextPaginator.kt',
    category: 'Feature Reader',
    description: 'Математический расчет пагинации на Dispatchers.Default с переносом по границам слов и LRU-кешем',
    content: `package com.example.interactivereader.feature_reader.domain.pagination

import androidx.compose.runtime.Immutable
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.coroutineContext

@Immutable
data class ScreenConstraints(
    val widthPx: Int,
    val heightPx: Int,
    val density: Float,
    val fontScale: Float = 1f
) {
    val isValid: Boolean get() = widthPx > 0 && heightPx > 0 && density > 0f
}

@Immutable
data class PageModel(
    val pageIndex: Int,
    val startCharOffset: Int,
    val endCharOffset: Int,
    val text: String
)

@Immutable
data class PaginationCacheKey(
    val chapterId: Long,
    val widthPx: Int,
    val heightPx: Int,
    val fontSizeSp: Float,
    val lineHeightSp: Float
)

@Singleton
class TextPaginator @Inject constructor(
    private val fontFamilyResolver: FontFamily.Resolver,
    private val defaultDispatcher: CoroutineDispatcher = Dispatchers.Default
) {
    private val cacheMutex = Mutex()
    private val lruCache = object : LinkedHashMap<PaginationCacheKey, List<PageModel>>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<PaginationCacheKey, List<PageModel>>?): Boolean = size > 24
    }

    suspend fun paginate(
        chapterId: Long,
        content: String,
        constraints: ScreenConstraints,
        style: TextStyle
    ): List<PageModel> = withContext(defaultDispatcher) {
        if (!constraints.isValid) return@withContext emptyList()
        val key = PaginationCacheKey(
            chapterId = chapterId,
            widthPx = constraints.widthPx,
            heightPx = constraints.heightPx,
            fontSizeSp = if (style.fontSize.isSp) style.fontSize.value else 18f,
            lineHeightSp = if (style.lineHeight.isSp) style.lineHeight.value else 27f
        )
        cacheMutex.withLock { lruCache[key]?.let { return@withContext it } }

        val measurer = TextMeasurer(
            defaultFontFamilyResolver = fontFamilyResolver,
            defaultDensity = Density(constraints.density, constraints.fontScale),
            defaultLayoutDirection = LayoutDirection.Ltr,
            cacheSize = 0
        )

        val pages = ArrayList<PageModel>()
        val totalLength = content.length
        var currentStartOffset = 0
        var pageIndex = 0
        val maxHeightFloat = constraints.heightPx.toFloat()
        val layoutConstraints = Constraints(maxWidth = constraints.widthPx, maxHeight = Constraints.Infinity)

        while (currentStartOffset < totalLength) {
            coroutineContext.ensureActive()
            while (currentStartOffset < totalLength && (content[currentStartOffset] == ' ' || content[currentStartOffset] == '\\n')) {
                currentStartOffset++
            }
            if (currentStartOffset >= totalLength) break

            val windowEnd = (currentStartOffset + 5500).coerceAtMost(totalLength)
            val slice = content.substring(currentStartOffset, windowEnd)
            val layoutResult = measurer.measure(
                text = AnnotatedString(slice),
                style = style,
                overflow = TextOverflow.Clip,
                softWrap = true,
                constraints = layoutConstraints
            )

            val candidateLine = layoutResult.getLineForVerticalPosition(maxHeightFloat).coerceIn(0, layoutResult.lineCount - 1)
            val lastVisibleLine = if (candidateLine > 0 && layoutResult.getLineBottom(candidateLine) > maxHeightFloat) {
                candidateLine - 1
            } else {
                candidateLine
            }

            val relativeEnd = layoutResult.getLineEnd(lastVisibleLine, visibleEnd = false).coerceAtLeast(1)
            val rawEndOffset = (currentStartOffset + relativeEnd).coerceAtMost(totalLength)
            val finalEndOffset = adjustToWordBoundary(content, currentStartOffset, rawEndOffset)

            pages.add(
                PageModel(
                    pageIndex = pageIndex,
                    startCharOffset = currentStartOffset,
                    endCharOffset = finalEndOffset,
                    text = content.substring(currentStartOffset, finalEndOffset).trimEnd()
                )
            )
            currentStartOffset = finalEndOffset
            pageIndex++
        }

        cacheMutex.withLock { lruCache[key] = pages }
        pages
    }

    private fun adjustToWordBoundary(content: String, startOffset: Int, rawEndOffset: Int): Int {
        if (rawEndOffset >= content.length || rawEndOffset <= startOffset) return rawEndOffset
        if (content[rawEndOffset - 1].isWhitespace() || content[rawEndOffset].isWhitespace()) return rawEndOffset
        var cursor = rawEndOffset - 1
        while (cursor > startOffset) {
            if (content[cursor].isWhitespace()) return cursor + 1
            cursor--
        }
        return rawEndOffset
    }

    fun findPageIndexForOffset(pages: List<PageModel>, charOffset: Int): Int {
        if (pages.isEmpty()) return 0
        val clamped = charOffset.coerceAtLeast(0)
        val found = pages.indexOfFirst { clamped in it.startCharOffset until it.endCharOffset }
        return if (found != -1) found else pages.lastIndex
    }

    fun getOffsetForPage(pages: List<PageModel>, pageIndex: Int): Int {
        if (pages.isEmpty()) return 0
        return pages[pageIndex.coerceIn(0, pages.lastIndex)].startCharOffset
    }
}
`,
  },
];
