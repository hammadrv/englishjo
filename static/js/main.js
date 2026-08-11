// State Management
let curriculumData = null;
let currentUnit = null;
let currentLesson = null;
let slides = [];
let currentSlide = null;
let currentExercise = null;

let currentIndex = 0;
let teacherNotesVisible = false;
let currentActiveTheme = 'coral';

// Active Slide Block Order State (Visual Block Builder)
let activeBlocksOrder = ['badge_title', 'description', 'image_box', 'rule_box', 'example_box'];
let hiddenBlocksMap = {};
let insertTargetIndex = null;
const richTextStateKeys = {
    formDescriptionAr: 'description_ar',
    formDescriptionEn: 'description_en',
    formExampleEn: 'example_en',
    formExampleAr: 'example_ar'
};

function stripHtml(html) {
    const div = document.createElement('div');
    div.innerHTML = html || '';
    return (div.textContent || div.innerText || '').trim();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

function normalizeRichTextHtml(html) {
    const template = document.createElement('template');
    template.innerHTML = html || '';
    const allowedTags = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'MARK', 'BR', 'UL', 'OL', 'LI', 'P', 'DIV']);
    const blockTags = new Set(['P', 'DIV']);

    template.content.querySelectorAll('*').forEach(el => {
        if (!allowedTags.has(el.tagName)) {
            el.replaceWith(...Array.from(el.childNodes));
            return;
        }

        Array.from(el.attributes).forEach(attr => el.removeAttribute(attr.name));
    });

    let cleaned = template.innerHTML
        .replace(/<div><br><\/div>/gi, '<br>')
        .replace(/<p><br><\/p>/gi, '<br>');

    blockTags.forEach(tag => {
        const lower = tag.toLowerCase();
        cleaned = cleaned
            .replace(new RegExp(`<${lower}>`, 'gi'), '')
            .replace(new RegExp(`</${lower}>`, 'gi'), '<br>');
    });

    return cleaned.replace(/(<br>\s*){3,}/gi, '<br><br>').trim();
}

function richTextEditorHtml(targetId, placeholder, direction = 'rtl') {
    return `
        <div class="mini-rich-editor" data-rich-wrapper="${targetId}">
            <div class="mini-rich-toolbar" role="toolbar" aria-label="أدوات تنسيق الشرح">
                <button type="button" class="mini-rich-btn" data-rich-command="bold" title="غامق"><i class="fa-solid fa-bold"></i></button>
                <button type="button" class="mini-rich-btn" data-rich-command="italic" title="مائل"><i class="fa-solid fa-italic"></i></button>
                <button type="button" class="mini-rich-btn" data-rich-command="underline" title="تحته خط"><i class="fa-solid fa-underline"></i></button>
                <button type="button" class="mini-rich-btn" data-rich-action="mark" title="تمييز"><i class="fa-solid fa-highlighter"></i></button>
                <button type="button" class="mini-rich-btn" data-rich-command="insertUnorderedList" title="نقاط"><i class="fa-solid fa-list-ul"></i></button>
                <button type="button" class="mini-rich-btn" data-rich-command="insertOrderedList" title="ترقيم"><i class="fa-solid fa-list-ol"></i></button>
                <button type="button" class="mini-rich-btn" data-rich-action="clear" title="إزالة التنسيق"><i class="fa-solid fa-eraser"></i></button>
            </div>
            <div class="mini-rich-surface ${direction === 'ltr' ? 'ltr' : ''}" contenteditable="true" data-rich-editor="${targetId}" data-placeholder="${placeholder}"></div>
            <textarea id="${targetId}" class="rich-hidden-field" tabindex="-1"></textarea>
        </div>
    `;
}

function initRichTextEditors(scope = document) {
    scope.querySelectorAll('[data-rich-editor]').forEach(editor => {
        if (editor.dataset.richReady === 'true') return;

        const target = document.getElementById(editor.dataset.richEditor);
        if (target) editor.innerHTML = target.value || '';

        const syncTarget = () => {
            if (!target) return;
            target.value = normalizeRichTextHtml(editor.innerHTML);
            editor.innerHTML = target.value;
            const stateKey = richTextStateKeys[editor.dataset.richEditor];
            if (stateKey) currentFormDataStore[stateKey] = target.value;
            updateLivePreview();
        };

        editor.addEventListener('input', () => {
            if (target) target.value = normalizeRichTextHtml(editor.innerHTML);
            updateLivePreview();
        });

        editor.addEventListener('blur', syncTarget);

        editor.addEventListener('paste', e => {
            e.preventDefault();
            const text = (e.clipboardData || window.clipboardData).getData('text/plain');
            document.execCommand('insertText', false, text);
        });

        const wrapper = editor.closest('.mini-rich-editor');
        wrapper?.querySelectorAll('[data-rich-command], [data-rich-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                editor.focus();
                if (btn.dataset.richAction === 'clear') {
                    document.execCommand('removeFormat', false, null);
                } else if (btn.dataset.richAction === 'mark') {
                    const selection = window.getSelection();
                    const selectedText = selection ? selection.toString() : '';
                    document.execCommand('insertHTML', false, `<mark>${escapeHtml(selectedText || 'نص مهم')}</mark>`);
                } else {
                    document.execCommand(btn.dataset.richCommand, false, btn.dataset.richValue || null);
                }
                syncTarget();
            });
        });

        editor.dataset.richReady = 'true';
    });
}

function syncCurriculumState(nextCurriculum, preferredLessonId = null, options = {}) {
    if (!nextCurriculum || !Array.isArray(nextCurriculum.units)) return null;

    const previousUnitId = currentUnit ? currentUnit.id : null;
    const targetLessonId = preferredLessonId || (currentLesson ? currentLesson.id : null);
    curriculumData = nextCurriculum;

    currentUnit = curriculumData.units.find(u => u.id === previousUnitId)
        || curriculumData.units.find(u => targetLessonId && (u.lessons || []).some(l => l.id === targetLessonId))
        || curriculumData.units[0]
        || null;

    if (!currentUnit) {
        currentLesson = null;
        slides = [];
        currentExercise = null;
        return null;
    }

    currentLesson = (currentUnit.lessons || []).find(l => l.id === targetLessonId)
        || (currentUnit.lessons || [])[0]
        || null;

    if (!currentLesson) {
        slides = [];
        currentExercise = null;
        return null;
    }

    const preferReinforcement = options.preferReinforcement || (currentSlide && currentSlide.is_reinforcement);
    slides = preferReinforcement ? (currentLesson.reinforcement_slides || []) : (currentLesson.slides || []);
    currentExercise = currentLesson.exercise || ((currentLesson.exercises || [])[0]) || null;
    return currentLesson;
}

document.addEventListener('DOMContentLoaded', () => {
    // Stage Screens
    const studentDashboardScreen = document.getElementById('studentDashboardScreen');
    const explanationStageContent = document.getElementById('explanationStageContent');
    const exerciseStageContent = document.getElementById('exerciseStageContent');
    const returnDashboardBtn = document.getElementById('returnDashboardBtn');
    const exerciseBackBtn = document.getElementById('exerciseBackBtn');

    // Navigation Controls
    const prevSlideBtn = document.getElementById('prevSlideBtn');
    const nextSlideBtn = document.getElementById('nextSlideBtn');
    const speakAudioBtn = document.getElementById('speakAudioBtn');
    const toggleTeacherNotesBtn = document.getElementById('toggleTeacherNotesBtn');

    // Studio Navigation Elements
    const presentationView = document.getElementById('presentationView');
    const studioView = document.getElementById('studioView');
    const toggleTeacherStudioBtn = document.getElementById('toggleTeacherStudioBtn');
    const closeStudioBtn1 = document.getElementById('closeStudioBtn1');
    const backToUnitsGridBtn = document.getElementById('backToUnitsGridBtn');

    // Modals
    const addSlideTemplateModal = document.getElementById('addSlideTemplateModal');
    const closeTemplatePickerBtn = document.getElementById('closeTemplatePickerBtn');

    const slideEditModal = document.getElementById('slideEditModal');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const slideEditForm = document.getElementById('slideEditForm');
    const deleteSlideBtn = document.getElementById('deleteSlideBtn');
    const addNewBlockBtn = document.getElementById('addNewBlockBtn');

    const exerciseEditModal = document.getElementById('exerciseEditModal');
    const closeExerciseModalBtn = document.getElementById('closeExerciseModalBtn');
    const exerciseEditForm = document.getElementById('exerciseEditForm');

    // Inserter Menu Modal Elements
    const addBlockMenuModal = document.getElementById('addBlockMenuModal');
    const closeAddBlockMenuBtn = document.getElementById('closeAddBlockMenuBtn');

    // Palette Color Buttons
    const paletteBtns = document.querySelectorAll('.palette-btn');
    paletteBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            paletteBtns.forEach(b => b.classList.remove('active'));
            const targetBtn = e.target.closest('.palette-btn');
            targetBtn.classList.add('active');
            currentActiveTheme = targetBtn.dataset.theme;
            applyThemeToPreview(currentActiveTheme);
        });
    });

    // Load initial curriculum
    loadCurriculum();

    // Top Navbar Navigation Tabs: Home vs Studio/Dashboard
    const topNavHomeBtn = document.getElementById('topNavHomeBtn');
    const topNavStudioBtn = document.getElementById('topNavStudioBtn');

    function switchToHomeView() {
        if (topNavHomeBtn) topNavHomeBtn.classList.add('active');
        if (topNavStudioBtn) topNavStudioBtn.classList.remove('active');
        if (studioView) studioView.classList.remove('active');
        if (presentationView) presentationView.classList.add('active');
        showStudentDashboard();
        showToast('🏠 تم فتح الصفحة الرئيسية (تطبيق الطالب)');
    }

    function switchToStudioView() {
        if (topNavStudioBtn) topNavStudioBtn.classList.add('active');
        if (topNavHomeBtn) topNavHomeBtn.classList.remove('active');
        if (presentationView) presentationView.classList.remove('active');
        if (studioView) studioView.classList.add('active');
        showStudioLevel2(1);
        showToast('⚙️ تم فتح لوحة التحكم وإدارة المحتوى');
    }

    if (topNavHomeBtn) {
        topNavHomeBtn.addEventListener('click', switchToHomeView);
    }

    if (topNavStudioBtn) {
        topNavStudioBtn.addEventListener('click', switchToStudioView);
    }

    // Toggle Teacher Studio Workspace (Switches between Studio and Student View)
    if (toggleTeacherStudioBtn) {
        toggleTeacherStudioBtn.addEventListener('click', () => {
            if (studioView && studioView.classList.contains('active')) {
                switchToHomeView();
            } else {
                switchToStudioView();
            }
        });
    }

    if (closeStudioBtn1) {
        closeStudioBtn1.addEventListener('click', () => {
            studioView.classList.remove('active');
            presentationView.classList.active;
            presentationView.classList.add('active');
        });
    }

    // Studio Level 1 -> Click Unit Card -> Go to Level 2 (Unit Workspace)
    const unitCards = document.querySelectorAll('.unit-manager-card');
    unitCards.forEach(card => {
        card.addEventListener('click', () => {
            const unitId = parseInt(card.dataset.unitId);
            showStudioLevel2(unitId);
        });
    });

    // Studio Level 2 Breadcrumb -> Back to Units Grid
    if (backToUnitsGridBtn) {
        backToUnitsGridBtn.addEventListener('click', () => showStudioLevel1());
    }

    // INLINE ACCORDION TOGGLE: CLICK ANYWHERE ON LESSON CARD HEADER (MATCHING USER REQUEST 100%)
    const lessonManagerCards = document.querySelectorAll('.lesson-manager-card');
    lessonManagerCards.forEach(card => {
        const header = card.querySelector('.lesson-card-header');
        if (!header) return;

        header.addEventListener('click', (e) => {
            const lessonId = parseInt(card.dataset.lessonId);
            const isCurrentlyExpanded = card.classList.contains('expanded');

            // Collapse all other lesson cards
            lessonManagerCards.forEach(c => c.classList.remove('expanded'));

            if (!isCurrentlyExpanded) {
                // Expand clicked lesson card inline in place!
                card.classList.add('expanded');
                if (currentUnit) {
                    currentLesson = currentUnit.lessons.find(l => l.id === lessonId) || currentUnit.lessons[0];
                    slides = currentLesson.slides;
                    currentExercise = currentLesson.exercise;
                }
                renderAccordionLessonContent(card, lessonId);
            }
        });

        // Tab Switching Inside Accordion Body
        const tabBtns = card.querySelectorAll('.studio-tab-btn');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation(); // Don't toggle accordion
                tabBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const target = btn.dataset.tabTarget;
                const expPanel = card.querySelector('.tab-panel-exp');
                const pracPanel = card.querySelector('.tab-panel-prac');

                if (target === 'exp') {
                    expPanel.classList.remove('hidden');
                    expPanel.classList.add('active');
                    pracPanel.classList.add('hidden');
                    pracPanel.classList.remove('active');
                } else if (target === 'prac') {
                    pracPanel.classList.remove('hidden');
                    pracPanel.classList.add('active');
                    expPanel.classList.add('hidden');
                    expPanel.classList.remove('active');
                }
            });
        });

        // Template Picker Button Inside Accordion
        const openPickerBtn = card.querySelector('.btn-open-template-picker');
        if (openPickerBtn) {
            openPickerBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (addSlideTemplateModal) addSlideTemplateModal.classList.remove('hidden');
            });
        }

        // Preview Student Slide Button Inside Accordion
        const previewSlideBtn = card.querySelector('.btn-preview-student-slide');
        if (previewSlideBtn) {
            previewSlideBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const lessonId = parseInt(card.dataset.lessonId);
                openLesson(lessonId);
                studioView.classList.remove('active');
                presentationView.classList.add('active');
            });
        }

        // Open Live Exercise Modal Button Inside Accordion
        const openLiveExBtn = card.querySelector('.btn-open-live-ex-modal');
        if (openLiveExBtn) {
            openLiveExBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const lessonId = parseInt(card.dataset.lessonId);
                if (currentUnit) {
                    currentLesson = currentUnit.lessons.find(l => l.id === lessonId) || currentUnit.lessons[0];
                    currentExercise = currentLesson.exercise;
                }
                openExerciseEditModal();
            });
        }
    });

    // Close Template Picker Modal
    if (closeTemplatePickerBtn) {
        closeTemplatePickerBtn.addEventListener('click', () => {
            if (addSlideTemplateModal) addSlideTemplateModal.classList.add('hidden');
        });
    }

    // Template Picker Cards Click
    const pickerCards = document.querySelectorAll('.picker-card-option');
    pickerCards.forEach(pCard => {
        pCard.addEventListener('click', async () => {
            const templateType = pCard.dataset.type;
            if (addSlideTemplateModal) addSlideTemplateModal.classList.add('hidden');
            await createNewSlideWithTemplate(templateType);
        });
    });

    // Add Block Top Button in Slide Edit Modal
    if (addNewBlockBtn) {
        addNewBlockBtn.addEventListener('click', () => {
            insertTargetIndex = activeBlocksOrder.length;
            if (addBlockMenuModal) addBlockMenuModal.classList.remove('hidden');
        });
    }

    if (closeAddBlockMenuBtn) {
        closeAddBlockMenuBtn.addEventListener('click', () => {
            if (addBlockMenuModal) addBlockMenuModal.classList.add('hidden');
        });
    }

    // Block Options Click
    const blockOptionItems = document.querySelectorAll('.block-option-item');
    blockOptionItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const targetCard = e.target.closest('.block-option-item');
            const blockType = targetCard ? targetCard.dataset.blockType : item.dataset.blockType;
            
            if (blockType) {
                if (insertTargetIndex !== null && insertTargetIndex >= 0) {
                    activeBlocksOrder.splice(insertTargetIndex, 0, blockType);
                } else {
                    activeBlocksOrder.push(blockType);
                }
            }
            
            if (addBlockMenuModal) addBlockMenuModal.classList.add('hidden');
            renderDynamicBlockEditors();
            updateLivePreview();
            showToast('✨ تمت إضافة العنصر بنجاح!');
        });
    });

    if (addBlockMenuModal) {
        addBlockMenuModal.classList.add('hidden'); // Force hide on initialization
        addBlockMenuModal.addEventListener('click', (e) => {
            if (e.target === addBlockMenuModal || e.target.classList.contains('edit-modal-backdrop')) {
                addBlockMenuModal.classList.add('hidden');
            }
        });
    }

    // Global ESC Key Close Handler for all Modals
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (addBlockMenuModal) addBlockMenuModal.classList.add('hidden');
            if (slideEditModal) slideEditModal.classList.add('hidden');
            if (addSlideTemplateModal) addSlideTemplateModal.classList.add('hidden');
            if (exerciseEditModal) exerciseEditModal.classList.add('hidden');
        }
    });

    // Student Dashboard Lesson Nav Cards Click
    const lessonNavCards = document.querySelectorAll('.lesson-nav-card');
    lessonNavCards.forEach(lCard => {
        lCard.addEventListener('click', (e) => {
            e.stopPropagation();
            const lessonId = parseInt(lCard.dataset.lessonId);
            openLesson(lessonId);
            showToast(`📱 تم فتح الدرس (${lessonId === 101 ? 'الأول' : 'الثاني'})`);
        });
    });

    // Return to Student Dashboard Buttons
    if (returnDashboardBtn) {
        returnDashboardBtn.addEventListener('click', () => {
            showStudentDashboard();
            showToast('🏠 العودة لقائمة دروس المنهاج');
        });
    }

    if (exerciseBackBtn) {
        exerciseBackBtn.addEventListener('click', () => {
            showStudentDashboard();
            showToast('🏠 العودة لقائمة دروس المنهاج');
        });
    }

    // Close Live Exercise Modal
    if (closeExerciseModalBtn) {
        closeExerciseModalBtn.addEventListener('click', () => {
            if (exerciseEditModal) exerciseEditModal.classList.add('hidden');
        });
    }

    // Edit Unit Modal Listeners
    const btnEditUnitName = document.getElementById('btnEditUnitName') || document.querySelector('.btn-edit-unit-name');
    const editUnitModal = document.getElementById('editUnitModal');
    const closeUnitModalBtn = document.getElementById('closeUnitModalBtn');
    const cancelUnitModalBtn = document.getElementById('cancelUnitModalBtn');
    const editUnitForm = document.getElementById('editUnitForm');

    if (btnEditUnitName) {
        btnEditUnitName.addEventListener('click', () => {
            if (!currentUnit) return;
            document.getElementById('formUnitId').value = currentUnit.id;
            document.getElementById('formUnitTitleAr').value = currentUnit.title_ar || '';
            document.getElementById('formUnitTitleEn').value = currentUnit.title_en || '';
            if (editUnitModal) editUnitModal.classList.remove('hidden');
        });
    }

    if (closeUnitModalBtn) closeUnitModalBtn.addEventListener('click', () => editUnitModal && editUnitModal.classList.add('hidden'));
    if (cancelUnitModalBtn) cancelUnitModalBtn.addEventListener('click', () => editUnitModal && editUnitModal.classList.add('hidden'));

    if (editUnitForm) {
        editUnitForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const unitId = parseInt(document.getElementById('formUnitId').value);
            const titleAr = document.getElementById('formUnitTitleAr').value.trim();
            const titleEn = document.getElementById('formUnitTitleEn').value.trim();

            try {
                const res = await fetch(`/api/units/${unitId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title_ar: titleAr, title_en: titleEn })
                });
                const data = await res.json();
                if (data.success) {
                    curriculumData = data.curriculum;
                    currentUnit = curriculumData.units.find(u => u.id === unitId) || curriculumData.units[0];
                    document.getElementById('selectedUnitTitle').textContent = currentUnit.title_ar;
                    if (editUnitModal) editUnitModal.classList.add('hidden');
                    showToast('🎉 تم تحديث اسم الوحدة وحفظه على السيرفر بنجاح!');
                }
            } catch (err) {
                showToast('تعذر تحديث اسم الوحدة');
            }
        });
    }

    // Edit Lesson Modal Listeners
    const editLessonModal = document.getElementById('editLessonModal');
    const closeLessonModalBtn = document.getElementById('closeLessonModalBtn');
    const cancelLessonModalBtn = document.getElementById('cancelLessonModalBtn');
    const editLessonForm = document.getElementById('editLessonForm');

    if (closeLessonModalBtn) closeLessonModalBtn.addEventListener('click', () => editLessonModal && editLessonModal.classList.add('hidden'));
    if (cancelLessonModalBtn) cancelLessonModalBtn.addEventListener('click', () => editLessonModal && editLessonModal.classList.add('hidden'));

    if (editLessonForm) {
        editLessonForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const lessonId = parseInt(document.getElementById('formLessonEditId').value);
            const titleAr = document.getElementById('formLessonTitleAr').value.trim();
            const titleEn = document.getElementById('formLessonTitleEn').value.trim();

            try {
                const res = await fetch(`/api/lessons/${lessonId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title_ar: titleAr, title_en: titleEn })
                });
                const data = await res.json();
                if (data.success) {
                    curriculumData = data.curriculum;
                    if (currentUnit) currentUnit = curriculumData.units.find(u => u.id === currentUnit.id) || curriculumData.units[0];
                    renderUnitLessonsList();
                    if (editLessonModal) editLessonModal.classList.add('hidden');
                    showToast('🎉 تم تحديث اسم الدرس وتخزينه على السيرفر بنجاح!');
                }
            } catch (err) {
                showToast('تعذر تحديث اسم الدرس');
            }
        });
    }

    // Add New Lesson Modal Listeners
    const addNewLessonModal = document.getElementById('addNewLessonModal');
    const closeAddLessonModalBtn = document.getElementById('closeAddLessonModalBtn');
    const cancelAddLessonModalBtn = document.getElementById('cancelAddLessonModalBtn');
    const addNewLessonForm = document.getElementById('addNewLessonForm');

    if (closeAddLessonModalBtn) closeAddLessonModalBtn.addEventListener('click', () => addNewLessonModal && addNewLessonModal.classList.add('hidden'));
    if (cancelAddLessonModalBtn) cancelAddLessonModalBtn.addEventListener('click', () => addNewLessonModal && addNewLessonModal.classList.add('hidden'));

    if (addNewLessonForm) {
        addNewLessonForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const titleAr = document.getElementById('formNewLessonTitleAr').value.trim();
            const titleEn = document.getElementById('formNewLessonTitleEn').value.trim();
            const unitId = currentUnit ? currentUnit.id : 1;

            try {
                const res = await fetch('/api/lessons', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ unit_id: unitId, title_ar: titleAr, title_en: titleEn })
                });
                const data = await res.json();
                if (data.success) {
                    curriculumData = data.curriculum;
                    currentUnit = curriculumData.units.find(u => u.id === unitId) || curriculumData.units[0];
                    renderUnitLessonsList();
                    if (addNewLessonModal) addNewLessonModal.classList.add('hidden');
                    showToast('🎉 تم إضافة الدرس الجديد وتخزينه بنجاح!');
                }
            } catch (err) {
                showToast('تعذر إضافة الدرس الجديد');
            }
        });
    }

    // Exercise Question Template Picker Modal Handler
    const exercisePickerOptions = document.querySelectorAll('.picker-exercise-option');
    exercisePickerOptions.forEach(pOpt => {
        pOpt.addEventListener('click', async () => {
            const templateType = pOpt.dataset.type;
            const addExerciseTemplateModal = document.getElementById('addExerciseTemplateModal');
            if (addExerciseTemplateModal) addExerciseTemplateModal.classList.add('hidden');

            const lessonId = currentLesson ? currentLesson.id : 101;
            try {
                const res = await fetch('/api/exercises', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ lesson_id: lessonId, template_type: templateType })
                });
                const data = await res.json();
                if (data.success) {
                    curriculumData = data.curriculum;
                    if (currentUnit) currentUnit = curriculumData.units.find(u => u.id === currentUnit.id) || curriculumData.units[0];
                    renderUnitLessonsList();
                    showToast('🎉 تم إضافة سؤال التمرين الجديد بنجاح!');
                }
            } catch (err) {
                showToast('تعذر إضافة سؤال التمرين');
            }
        });
    });

    const closeExerciseTemplatePickerBtn = document.getElementById('closeExerciseTemplatePickerBtn');
    if (closeExerciseTemplatePickerBtn) {
        closeExerciseTemplatePickerBtn.addEventListener('click', () => {
            const addExerciseTemplateModal = document.getElementById('addExerciseTemplateModal');
            if (addExerciseTemplateModal) addExerciseTemplateModal.classList.add('hidden');
        });
    }

    // Navigation Buttons in Mobile View
    if (prevSlideBtn) {
        prevSlideBtn.addEventListener('click', () => {
            if (currentIndex > 0) {
                currentIndex--;
                renderCurrentSlide();
            }
        });
    }

    if (nextSlideBtn) {
        nextSlideBtn.addEventListener('click', () => {
            if (currentIndex < slides.length - 1) {
                currentIndex++;
                renderCurrentSlide();
            } else {
                showToast('🎯 أحسنت! انتقلت الآن لتمرين الدرس التفاعلي');
                showExerciseStage();
            }
        });
    }

    // Toggle Teacher Notes
    if (toggleTeacherNotesBtn) {
        toggleTeacherNotesBtn.addEventListener('click', () => {
            teacherNotesVisible = !teacherNotesVisible;
            const panel = document.getElementById('teacherNotesPanel');
            if (panel) {
                if (teacherNotesVisible) panel.classList.remove('hidden');
                else panel.classList.add('hidden');
            }
        });
    }

    // Text to Speech Audio
    if (speakAudioBtn) {
        speakAudioBtn.addEventListener('click', () => {
            const slide = slides[currentIndex];
            if (!slide || !slide.example_en) return;

            if ('speechSynthesis' in window) {
                window.speechSynthesis.cancel();
                const textToSpeak = slide.example_en.replace(/[\n\r]/g, ' ');
                const utterance = new SpeechSynthesisUtterance(textToSpeak);
                utterance.lang = 'en-US';
                utterance.rate = 0.85;
                window.speechSynthesis.speak(utterance);
                showToast('🔊 استمع لنطق الجملة بالإنجليزية');
            } else {
                showToast('خاصية الصوت غير مدعومة في المتصفح');
            }
        });
    }

    // Close Slide Edit Modal
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => {
            if (slideEditModal) slideEditModal.classList.add('hidden');
        });
    }

    // Save Slide Edit Form
    if (slideEditForm) {
        slideEditForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const slideId = parseInt(document.getElementById('formSlideId').value);
            
            const formImageSelect = document.getElementById('formImageSelect');
            let imageVal = formImageSelect ? formImageSelect.value : '';
            if (imageVal === 'custom' || imageVal === 'upload') {
                const customUrl = document.getElementById('formCustomImageUrl');
                imageVal = customUrl ? customUrl.value.trim() : '';
            }

            const getVal = (id) => {
                const el = document.getElementById(id);
                return el ? el.value.trim() : '';
            };

            const updatedData = {
                welcome_badge: getVal('formWelcomeBadge'),
                title_ar: getVal('formTitleAr'),
                title_en: getVal('formTitleEn'),
                description_ar: getVal('formDescriptionAr'),
                description_en: getVal('formDescriptionEn'),
                rule_title: getVal('formRuleTitle'),
                rule_desc: getVal('formRuleDesc'),
                example_en: getVal('formExampleEn'),
                example_ar: getVal('formExampleAr'),
                image: imageVal,
                teacher_notes: getVal('formTeacherNotes'),
                blocks_order: activeBlocksOrder,
                // Discovery / Two Stage fields
                scene_badge: getVal('formTwoStageSceneBadge') || getVal('formDiscSceneBadge'),
                question_ar: getVal('formTwoStageQuestion') || getVal('formDiscQuestion'),
                hint_note: getVal('formTwoStageHintNote'),
                wrong_note: getVal('formTwoStageWrongNote'),
                options: [
                    getVal('formTwoStageOpt0') || getVal('formDiscOpt0') || "He plays football.",
                    getVal('formTwoStageOpt1') || getVal('formDiscOpt1') || "He play football.",
                    getVal('formTwoStageOpt2') || getVal('formDiscOpt2') || "He playing football."
                ],
                result_title: getVal('formTwoStageResultTitle') || getVal('formDiscResultTitle'),
                reveal_badge: getVal('formTwoStageRevealBadge') || getVal('formDiscRevealBadge'),
                reveal_explanation: getVal('formTwoStageRevealExplanation') || getVal('formDiscRevealExplanation'),
                reveal_note: getVal('formDiscRevealNote')
            };

            try {
                const res = await fetch(`/api/slides/${slideId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updatedData)
                });
                const data = await res.json();
                if (data.success) {
                    const expandedCard = document.querySelector('.lesson-manager-card.expanded');
                    const lessonId = expandedCard ? parseInt(expandedCard.dataset.lessonId) : (currentLesson ? currentLesson.id : null);
                    syncCurriculumState(data.curriculum, lessonId, { preferReinforcement: currentSlide && currentSlide.is_reinforcement });

                    if (expandedCard) {
                        renderAccordionLessonContent(expandedCard, lessonId);
                    }
                    if (slideEditModal) slideEditModal.classList.add('hidden');
                    showToast('تم حفظ الشريحة بنجاح!');
                }
            } catch (err) {
                showToast('تعذر حفظ الشريحة');
            }
        });
    }

    // Palette Color Buttons for Exercise Modal
    const exPaletteBtns = document.querySelectorAll('.ex-palette-btn');
    exPaletteBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            exPaletteBtns.forEach(b => b.classList.remove('active'));
            const targetBtn = e.target.closest('.ex-palette-btn');
            targetBtn.classList.add('active');
            activeExTheme = targetBtn.dataset.theme;
            applyExThemeToPreview(activeExTheme);
        });
    });

    // Save Exercise Form Live (Visual Block Builder)
    if (exerciseEditForm) {
        exerciseEditForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const exId = parseInt(document.getElementById('formExerciseId').value);
            
            const getVal = (id) => {
                const el = document.getElementById(id);
                return el ? el.value.trim() : '';
            };

            let exImageVal = getVal('formExImage');
            if (exImageVal === 'custom' || exImageVal === 'upload') {
                exImageVal = getVal('formExCustomImageUrl');
            }

            const updatedData = {
                instruction_badge: getVal('formExBadge'),
                sentence_ar: getVal('formExSentenceAr'),
                question_en: getVal('formExQuestionEn'),
                options: [
                    getVal('formExOpt0'),
                    getVal('formExOpt1'),
                    getVal('formExOpt2')
                ],
                correct_index: parseInt(getVal('formExCorrect')) || 0,
                explanation: getVal('formExExplanation'),
                image: exImageVal || '/static/images/girl_reading_library.jpg',
                theme: activeExTheme,
                blocks_order: activeExBlocksOrder,
                hidden_blocks: activeExHiddenBlocks
            };

            try {
                const res = await fetch(`/api/exercises/${exId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updatedData)
                });
                const data = await res.json();
                if (data.success) {
                    curriculumData = data.curriculum;
                    if (currentUnit) currentUnit = curriculumData.units.find(u => u.id === currentUnit.id) || curriculumData.units[0];
                    const expandedCard = document.querySelector('.lesson-manager-card.expanded');
                    if (expandedCard) {
                        const lessonId = parseInt(expandedCard.dataset.lessonId);
                        renderAccordionLessonContent(expandedCard, lessonId);
                    }
                    if (exerciseEditModal) exerciseEditModal.classList.add('hidden');
                    showToast('🎉 تم حفظ التمرين الموديولي والترتيب بنجاح!');
                }
            } catch (err) {
                showToast('تعذر حفظ بيانات التمرين');
            }
        });
    }

    // Exercise Edit Modal Image Select & Upload Handler
    const formExImage = document.getElementById('formExImage');
    if (formExImage) {
        formExImage.addEventListener('change', (e) => {
            const exCustomContainer = document.getElementById('exCustomUrlContainer');
            const exUploadContainer = document.getElementById('exFileUploadContainer');

            if (e.target.value === 'custom') {
                if (exCustomContainer) exCustomContainer.classList.remove('hidden');
                if (exUploadContainer) exUploadContainer.classList.add('hidden');
            } else if (e.target.value === 'upload') {
                if (exUploadContainer) exUploadContainer.classList.remove('hidden');
                if (exCustomContainer) exCustomContainer.classList.remove('hidden');
            } else {
                if (exCustomContainer) exCustomContainer.classList.add('hidden');
                if (exUploadContainer) exUploadContainer.classList.add('hidden');
            }
            updateExerciseLivePreview();
        });
    }

    const exFileInput = document.getElementById('formExFileUpload');
    if (exFileInput) {
        exFileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const statusText = document.getElementById('exUploadStatusText');
            if (statusText) statusText.textContent = "⏳ جاري رفع الصورة إلى النظام...";

            const formData = new FormData();
            formData.append('image_file', file);

            try {
                const res = await fetch('/api/upload_image', { method: 'POST', body: formData });
                const data = await res.json();
                if (data.success) {
                    const customUrlInput = document.getElementById('formExCustomImageUrl');
                    if (customUrlInput) customUrlInput.value = data.image_url;
                    if (statusText) statusText.textContent = `✓ تم الرفع بنجاح! (${file.name})`;
                    updateExerciseLivePreview();
                    showToast('🎉 تم رفع صورة التمرين من الكمبيوتر بنجاح!');
                }
            } catch (err) {
                if (statusText) statusText.textContent = "❌ فشل رفع الصورة";
                showToast('تعذر رفع صورة التمرين من جهازك');
            }
        });
    }
});

// Studio Navigation Levels
function showStudioLevel1() {
    document.getElementById('studioLevel1').classList.remove('hidden');
    document.getElementById('studioLevel2').classList.add('hidden');
}

function showStudioLevel2(unitId) {
    if (!curriculumData) return;
    currentUnit = curriculumData.units.find(u => u.id === unitId) || curriculumData.units[0];
    
    document.getElementById('selectedUnitTitle').textContent = currentUnit.title_ar;
    document.getElementById('selectedUnitSub').textContent = `انقر على أي درس لتمدده ورؤية محتوياته في نفس المكان`;

    document.getElementById('studioLevel1').classList.add('hidden');
    document.getElementById('studioLevel2').classList.remove('hidden');

    renderUnitLessonsList();
}

function renderUnitLessonsList() {
    const container = document.getElementById('unitLessonsList');
    if (!container || !currentUnit || !currentUnit.lessons) return;

    const currentExpandedCard = container.querySelector('.lesson-manager-card.expanded');
    const expandedLessonId = currentExpandedCard ? parseInt(currentExpandedCard.dataset.lessonId) : (currentUnit.lessons[0] ? currentUnit.lessons[0].id : null);

    container.innerHTML = '';
    currentUnit.lessons.forEach((lesson, lIdx) => {
        const numStr = String(lIdx + 1).padStart(2, '0');
        const card = document.createElement('div');
        card.className = `lesson-manager-card ${lesson.id === expandedLessonId ? 'expanded' : ''}`;
        card.dataset.lessonId = lesson.id;

        card.innerHTML = `
            <div class="lesson-card-header">
                <div class="lesson-card-right">
                    <span class="lesson-num-badge">${numStr}</span>
                    <div>
                        <div style="display:flex; align-items:center; gap:0.5rem;">
                            <span class="lesson-tag">${lesson.badge || 'الدرس ' + (lIdx + 1)}</span>
                            <button type="button" class="btn-edit-lesson-trigger" style="background:transparent; border:none; color:#0D9488; font-size:1.1rem; cursor:pointer; padding:0 0.3rem;" title="تعديل اسم الدرس">
                                <i class="fa-solid fa-pen-to-square"></i>
                            </button>
                        </div>
                        <h3 class="lesson-name-ar">${lesson.title_ar}</h3>
                        <span class="lesson-name-en">${lesson.title_en}</span>
                    </div>
                </div>

                <div class="lesson-card-left">
                    <div class="lesson-meta-badges">
                        <span class="meta-badge purple">${(lesson.slides ? lesson.slides.length : 0)} شرائح</span>
                        <span class="meta-badge teal">شرح تفاعلي</span>
                        <span class="meta-badge peach">تمرين تفاعلي</span>
                    </div>
                    <div class="accordion-toggle-arrow"><i class="fa-solid fa-chevron-down"></i></div>
                </div>
            </div>

            <div class="lesson-accordion-body">
                <div class="studio-accordion-top-bar" style="margin-bottom: 1.2rem;">
                    <div class="studio-accordion-tabs" style="display: flex; flex-direction: row; gap: 0.6rem; background: #F1F5F9; border: 1.5px solid #CBD5E1; padding: 6px; border-radius: 18px; width: 100%;">
                        <button class="studio-tab-btn active" data-tab-target="exp" style="flex: 1; margin: 0;">
                            <i class="fa-solid fa-book-open"></i> 📚 الشرح
                        </button>
                        <button class="studio-tab-btn" data-tab-target="prac" style="flex: 1; margin: 0;">
                            <i class="fa-solid fa-pen-ruler"></i> ✏️ التمرين
                        </button>
                        <button class="studio-tab-btn" data-tab-target="reinf" style="flex: 1; margin: 0;">
                            <i class="fa-solid fa-bolt"></i> ⚡ التقوية
                        </button>
                        <button class="studio-tab-btn" data-tab-target="exam" style="flex: 1; margin: 0;">
                            <i class="fa-solid fa-award"></i> 📝 الاختبار
                        </button>
                    </div>
                </div>

                <div class="tab-panel-exp active">
                    <div class="tab-header-box">
                        <div>
                            <h4 class="tab-explanation-title">تسلسل شرائح الشرح في الدرس</h4>
                            <p class="tab-explanation-sub">ترتيب وتعديل شرائح الشرح. انقر على أي شريحة لتعديلها أو معاينتها.</p>
                        </div>
                        <button class="btn-add-slide btn-open-template-picker-modal">
                            <i class="fa-solid fa-plus-circle"></i> أضف شريحة جديدة
                        </button>
                    </div>
                    <div class="slides-sequence-list"></div>
                </div>

                <div class="tab-panel-prac hidden">
                    <div class="tab-header-box">
                        <div>
                            <h4 class="tab-explanation-title">بيانات التمرين التفاعلي للدرس</h4>
                            <p class="tab-explanation-sub">تعديل السؤال والترجمة والصورة والخيارات التي تظهر للطالب بعد الشرح.</p>
                        </div>
                        <button class="btn-add-slide btn-open-live-ex-modal" style="background: var(--teal-primary);">
                            <i class="fa-solid fa-pen-ruler"></i> محرر التمرين بالمعاينة الحية
                        </button>
                    </div>
                    <div class="studio-exercise-summary-card"></div>
                </div>

                <div class="tab-panel-reinf hidden">
                    <div class="tab-header-box" style="flex-wrap: wrap; gap: 1rem;">
                        <div>
                            <span class="sub-badge-teal" style="background: #FEF3C7; color: #92400E; border: 1px solid #FCD34D;">⚡ مرحلة التقوية بالدرس</span>
                            <h4 class="tab-explanation-title" style="margin: 0.2rem 0;">مرحلة تقوية المفاهيم بعد التمرين</h4>
                            <p class="tab-explanation-sub" style="margin: 0;">تحديد نوع التقوية المناسبة للدرس (شرح إضافي أو تمارين إضافية) وتعديل محتواها.</p>
                        </div>

                        <!-- Reinforcement Type Radio Selector -->
                        <div class="reinforcement-type-selector" style="display: flex; background: #F1F5F9; padding: 0.3rem; border-radius: 50px; border: 1.5px solid #CBD5E1; gap: 0.3rem;">
                            <button type="button" class="btn-reinf-type active" data-reinf-type="slides" style="border: none; padding: 0.5rem 1.1rem; border-radius: 50px; font-weight: 800; font-size: 0.88rem; cursor: pointer; background: #FFFFFF; color: #D97706; box-shadow: 0 2px 6px rgba(0,0,0,0.08);">
                                📚 شرح تقوية (شرائح إضافية)
                            </button>
                            <button type="button" class="btn-reinf-type" data-reinf-type="exercise" style="border: none; padding: 0.5rem 1.1rem; border-radius: 50px; font-weight: 800; font-size: 0.88rem; cursor: pointer; background: transparent; color: #64748B;">
                                ✏️ تمرين تقوية (أسئلة إضافية)
                            </button>
                        </div>
                    </div>
                    <div class="studio-reinforcement-summary-card" style="margin-top: 1.5rem;"></div>
                </div>

                <div class="tab-panel-exam hidden">
                    <div class="tab-header-box" style="flex-wrap: wrap; gap: 1rem;">
                        <div>
                            <span class="sub-badge-teal" style="background: #ECFDF5; color: #047857; border: 1px solid #A7F3D0;">📝 الاختبار النهائي لتقييم الإتقان</span>
                            <h4 class="tab-explanation-title" style="margin: 0.2rem 0;">اختبار تثبيت الفهم المعياري بعد التقوية</h4>
                            <p class="tab-explanation-sub" style="margin: 0;">أسئلة الاختبار النهائي لتأكيد إتقان الطالب المفهوم بنسبة 100% وإصدار وسام الإتقان.</p>
                        </div>
                    </div>
                    <div class="studio-exam-summary-card" style="margin-top: 1.5rem;"></div>
                </div>
            </div>
        `;

        const header = card.querySelector('.lesson-card-header');
        header.addEventListener('click', (e) => {
            if (e.target.closest('.btn-edit-lesson-trigger')) return;
            const allCards = container.querySelectorAll('.lesson-manager-card');
            const isExpanded = card.classList.contains('expanded');
            allCards.forEach(c => c.classList.remove('expanded'));
            if (!isExpanded) {
                card.classList.add('expanded');
                currentLesson = lesson;
                slides = lesson.slides;
                currentExercise = lesson.exercise;
                renderAccordionLessonContent(card, lesson.id);
            }
        });

        const editLessonIcon = card.querySelector('.btn-edit-lesson-trigger');
        if (editLessonIcon) {
            editLessonIcon.addEventListener('click', (e) => {
                e.stopPropagation();
                document.getElementById('formLessonEditId').value = lesson.id;
                document.getElementById('formLessonTitleAr').value = lesson.title_ar || '';
                document.getElementById('formLessonTitleEn').value = lesson.title_en || '';
                const editLessonModal = document.getElementById('editLessonModal');
                if (editLessonModal) editLessonModal.classList.remove('hidden');
            });
        }

        const tabBtns = card.querySelectorAll('.studio-tab-btn');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                tabBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const target = btn.dataset.tabTarget;
                const expPanel = card.querySelector('.tab-panel-exp');
                const pracPanel = card.querySelector('.tab-panel-prac');
                const reinfPanel = card.querySelector('.tab-panel-reinf');
                const examPanel = card.querySelector('.tab-panel-exam');

                if (target === 'exp') {
                    if (expPanel) { expPanel.classList.remove('hidden'); expPanel.classList.add('active'); }
                    if (pracPanel) { pracPanel.classList.add('hidden'); pracPanel.classList.remove('active'); }
                    if (reinfPanel) { reinfPanel.classList.add('hidden'); reinfPanel.classList.remove('active'); }
                    if (examPanel) { examPanel.classList.add('hidden'); examPanel.classList.remove('active'); }
                } else if (target === 'prac') {
                    if (pracPanel) { pracPanel.classList.remove('hidden'); pracPanel.classList.add('active'); }
                    if (expPanel) { expPanel.classList.add('hidden'); expPanel.classList.remove('active'); }
                    if (reinfPanel) { reinfPanel.classList.add('hidden'); reinfPanel.classList.remove('active'); }
                    if (examPanel) { examPanel.classList.add('hidden'); examPanel.classList.remove('active'); }
                } else if (target === 'reinf') {
                    if (reinfPanel) { reinfPanel.classList.remove('hidden'); reinfPanel.classList.add('active'); }
                    if (expPanel) { expPanel.classList.add('hidden'); expPanel.classList.remove('active'); }
                    if (pracPanel) { pracPanel.classList.add('hidden'); pracPanel.classList.remove('active'); }
                    if (examPanel) { examPanel.classList.add('hidden'); examPanel.classList.remove('active'); }
                } else if (target === 'exam') {
                    if (examPanel) { examPanel.classList.remove('hidden'); examPanel.classList.add('active'); }
                    if (expPanel) { expPanel.classList.add('hidden'); expPanel.classList.remove('active'); }
                    if (pracPanel) { pracPanel.classList.add('hidden'); pracPanel.classList.remove('active'); }
                    if (reinfPanel) { reinfPanel.classList.add('hidden'); reinfPanel.classList.remove('active'); }
                }
            });
        });

        card.querySelector('.btn-open-template-picker-modal')?.addEventListener('click', (e) => {
            e.stopPropagation();
            currentLesson = lesson;
            slides = lesson.slides;
            const addSlideTemplateModal = document.getElementById('addSlideTemplateModal');
            if (addSlideTemplateModal) addSlideTemplateModal.classList.remove('hidden');
        });

        card.querySelector('.btn-open-live-ex-modal')?.addEventListener('click', (e) => {
            e.stopPropagation();
            currentLesson = lesson;
            currentExercise = lesson.exercise;
            openExerciseEditModal();
        });

        container.appendChild(card);

        if (card.classList.contains('expanded')) {
            currentLesson = lesson;
            slides = lesson.slides;
            currentExercise = lesson.exercise;
            renderAccordionLessonContent(card, lesson.id);
        }
    });

    const newAddRow = document.createElement('div');
    newAddRow.className = 'add-lesson-row';
    newAddRow.style.cssText = 'margin-top: 1.5rem; text-align: center;';
    newAddRow.innerHTML = `
        <button type="button" id="btnAddLessonBtn" class="btn-add-lesson-large" style="background: linear-gradient(135deg, #0D9488 0%, #059669 100%); color: #FFFFFF; border: none; padding: 0.9rem 2rem; border-radius: 16px; font-weight: 800; font-size: 1rem; cursor: pointer; box-shadow: 0 4px 14px rgba(13, 148, 136, 0.3); display: inline-flex; align-items: center; gap: 0.6rem; transition: transform 0.2s ease;">
            <i class="fa-solid fa-plus-circle" style="font-size: 1.2rem;"></i> ➕ أضف درساً جديداً للوحدة
        </button>
    `;
    newAddRow.querySelector('#btnAddLessonBtn').addEventListener('click', () => {
        document.getElementById('formNewLessonTitleAr').value = '';
        document.getElementById('formNewLessonTitleEn').value = '';
        const addNewLessonModal = document.getElementById('addNewLessonModal');
        if (addNewLessonModal) addNewLessonModal.classList.remove('hidden');
    });

    container.appendChild(newAddRow);
}

// Render Accordion Lesson Content Inline Under Card
function renderAccordionLessonContent(card, lessonId) {
    if (!currentUnit) return;
    const lesson = currentUnit.lessons.find(l => l.id === lessonId) || currentUnit.lessons[0];
    const lSlides = lesson.slides;
    const lExercise = lesson.exercise;

    // Render Slides List in Tab 1 (Direct Unwrapped Sequence Cards)
    const slidesList = card.querySelector('.slides-sequence-list');
    if (slidesList) {
        slidesList.innerHTML = '';
        lSlides.forEach((slide, idx) => {
            const sCard = document.createElement('div');
            sCard.className = 'sequence-slide-card';
            const numStr = String(idx + 1).padStart(2, '0');

            sCard.innerHTML = `
                <div class="seq-right-section">
                    <div class="seq-index-box">
                        <span class="seq-num">${numStr}</span>
                        <span class="seq-drag-hint">${slide.template_type === 'discovery' ? 'استكشاف 🧭' : 'شريحة شرح 📘'}</span>
                    </div>
                    <img src="${slide.image || '/static/images/girl_school.jpg'}" alt="مصغّر الشريحة" class="seq-thumb-img">
                </div>

                <div class="seq-info-box">
                    <div class="seq-category">${slide.welcome_badge || 'شرح قاعدة'}</div>
                    <h3 class="seq-title">${slide.title_ar || slide.title_en}</h3>
                    <p class="seq-desc">${stripHtml(slide.description_ar || '')}</p>
                </div>

                <div class="seq-actions-box">
                    <button class="btn-seq-preview" data-idx="${idx}">معاينة الشريحة</button>
                    <button class="btn-seq-edit" data-idx="${idx}">تعديل الشريحة</button>
                    <button class="btn-seq-delete" data-idx="${idx}">حذف</button>
                </div>
            `;

            sCard.style.cursor = 'pointer';
            sCard.addEventListener('click', (e) => {
                if (e.target.closest('.btn-seq-preview') || e.target.closest('.btn-seq-delete')) return;
                e.stopPropagation();
                currentLesson = lesson;
                slides = lSlides;
                openEditModal(slide, idx);
            });

            sCard.querySelector('.btn-seq-preview').addEventListener('click', (e) => {
                e.stopPropagation();
                currentIndex = idx;
                slides = lSlides;
                currentLesson = lesson;
                document.getElementById('presentationView').classList.add('active');
                document.getElementById('studioView').classList.remove('active');
                document.getElementById('studentDashboardScreen').classList.add('hidden');
                document.getElementById('exerciseStageContent').classList.add('hidden');
                document.getElementById('explanationStageContent').classList.remove('hidden');
                renderCurrentSlide();
                showToast(`📱 معاينة شريحة رقم (${numStr}) في شاشة الموبايل`);
            });

            sCard.querySelector('.btn-seq-edit').addEventListener('click', (e) => {
                e.stopPropagation();
                currentLesson = lesson;
                slides = lSlides;
                openEditModal(slide, idx);
            });

            sCard.querySelector('.btn-seq-delete').addEventListener('click', async (e) => {
                e.stopPropagation();
                if (lSlides.length <= 1) {
                    showToast('يجب الاحتفاظ بشريحة واحدة على الأقل!');
                    return;
                }
                if (!confirm(`هل أنت تأكد من رغبتك في حذف الشريحة رقم (${numStr})؟`)) return;

                try {
                    const res = await fetch(`/api/slides/${slide.id}`, { method: 'DELETE' });
                    const data = await res.json();
                    if (data.success) {
                        curriculumData = data.curriculum;
                        if (currentUnit) currentUnit = curriculumData.units.find(u => u.id === currentUnit.id) || curriculumData.units[0];
                        if (currentLesson && currentUnit) currentLesson = currentUnit.lessons.find(l => l.id === lessonId) || currentUnit.lessons[0];
                        renderAccordionLessonContent(card, lessonId);
                        showToast('تم حذف الشريحة بنجاح');
                    }
                } catch (err) {
                    showToast('تعذر حذف الشريحة');
                }
            });

            slidesList.appendChild(sCard);
        });
    }

    // Render Exercises List in Tab 2
    const exSummary = card.querySelector('.studio-exercise-summary-card');
    const lExercises = (lesson.exercises && lesson.exercises.length > 0) ? lesson.exercises : (lesson.exercise ? [lesson.exercise] : []);

    if (exSummary) {
        exSummary.innerHTML = '';
        
        const exHeader = document.createElement('div');
        exHeader.style.cssText = 'display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem;';
        exHeader.innerHTML = `
            <div>
                <span class="sub-badge-teal">أسئلة التمرين التفاعلي (${lExercises.length})</span>
                <h2 style="font-size: 1.6rem; font-weight: 900; color: var(--text-navy); margin: 0.2rem 0;">تسلسل أسئلة تمرين الدرس</h2>
                <p class="tab-explanation-sub" style="margin: 0;">إضافة، ترتيب، وتعديل أسئلة التمرين التفاعلي التي تظهر للطالب بعد الشرح.</p>
            </div>
            <div style="display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap;">
                <button type="button" class="btn-test-all-exercises" style="background: linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%); color: #FFF; border: none; padding: 0.77rem 1.4rem; border-radius: 50px; font-weight: 800; cursor: pointer; display: inline-flex; align-items: center; gap: 0.5rem; box-shadow: 0 4px 14px rgba(124, 58, 237, 0.3); font-family: inherit; font-size: 0.95rem;">
                    <i class="fa-solid fa-flask"></i> 🧪 تجربة وااختبار التمارين (كطالب)
                </button>
                <button type="button" class="btn-add-ex-question" style="background: linear-gradient(135deg, #0D9488 0%, #059669 100%); color: #FFF; border: none; padding: 0.77rem 1.4rem; border-radius: 50px; font-weight: 800; cursor: pointer; display: inline-flex; align-items: center; gap: 0.5rem; box-shadow: 0 4px 14px rgba(13, 148, 136, 0.3); font-family: inherit; font-size: 0.95rem;">
                    <i class="fa-solid fa-plus-circle"></i> أضف سؤال تمرين جديد
                </button>
            </div>
        `;

        const btnTestAll = exHeader.querySelector('.btn-test-all-exercises');
        if (btnTestAll) {
            btnTestAll.addEventListener('click', (e) => {
                e.stopPropagation();
                runExerciseSimulator(lesson, 0);
            });
        }

        exHeader.querySelector('.btn-add-ex-question').addEventListener('click', (e) => {
            e.stopPropagation();
            currentLesson = lesson;
            const addExerciseTemplateModal = document.getElementById('addExerciseTemplateModal');
            if (addExerciseTemplateModal) addExerciseTemplateModal.classList.remove('hidden');
        });

        exSummary.appendChild(exHeader);

        if (lExercises.length === 0) {
            const emptyNotice = document.createElement('div');
            emptyNotice.style.cssText = 'padding: 1.5rem; text-align: center; color: #64748B; font-weight: 700; background: #F8FAFC; border-radius: 14px; border: 1.5px dashed #CBD5E1;';
            emptyNotice.textContent = 'لا يوجد أسئلة تمرين في هذا الدرس بعد. انقر على (أضف سؤال تمرين جديد) لأول سؤال.';
            exSummary.appendChild(emptyNotice);
        } else {
            lExercises.forEach((exItem, eIdx) => {
                const exCard = document.createElement('div');
                exCard.className = 'sequence-slide-card';
                exCard.style.cursor = 'pointer';
                
                const numStr = String(eIdx + 1).padStart(2, '0');

                exCard.innerHTML = `
                    <div class="seq-right-section">
                        <div class="seq-index-box">
                            <span class="seq-num">${numStr}</span>
                            <span class="seq-drag-hint">تمرين تفاعلي ✏️</span>
                        </div>
                        <img src="${exItem.image || '/static/images/girl_reading_library.jpg'}" alt="صورة التمرين" class="seq-thumb-img">
                    </div>

                    <div class="seq-info-box">
                        <div class="seq-category">${exItem.instruction_badge || 'تمرين تفاعلي'}</div>
                        <h3 class="seq-title" style="direction: ltr; text-align: left; font-family: 'Outfit', sans-serif;">${exItem.question_en}</h3>
                        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.4rem;">
                            ${exItem.options.map((opt, i) => `
                                <span style="background: ${i === exItem.correct_index ? '#D1FAE5' : '#F8FAFC'}; border: 1px solid ${i === exItem.correct_index ? '#10B981' : '#CBD5E1'}; color: ${i === exItem.correct_index ? '#065F46' : 'var(--text-navy)'}; padding: 0.2rem 0.6rem; border-radius: 8px; font-weight: 800; font-size: 0.8rem; font-family: 'Outfit', sans-serif;">
                                    ${opt} ${i === exItem.correct_index ? '✓' : ''}
                                </span>
                            `).join('')}
                        </div>
                    </div>

                    <div class="seq-actions-box">
                        <button class="btn-seq-preview btn-preview-ex-item">🧪 تجربة السؤال</button>
                        <button class="btn-seq-edit btn-edit-ex-item">تعديل التمرين</button>
                        <button class="btn-seq-delete btn-delete-ex-item">حذف</button>
                    </div>
                `;

                exCard.addEventListener('click', (e) => {
                    if (e.target.closest('.btn-preview-ex-item') || e.target.closest('.btn-delete-ex-item')) return;
                    e.stopPropagation();
                    currentLesson = lesson;
                    currentExercise = exItem;
                    openExerciseEditModal();
                });

                exCard.querySelector('.btn-preview-ex-item').addEventListener('click', (e) => {
                    e.stopPropagation();
                    runExerciseSimulator(lesson, eIdx);
                });

                exCard.querySelector('.btn-edit-ex-item').addEventListener('click', (e) => {
                    e.stopPropagation();
                    currentLesson = lesson;
                    currentExercise = exItem;
                    openExerciseEditModal();
                });

                exCard.querySelector('.btn-delete-ex-item').addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (!confirm('هل أنت تأكد من رغبتك في حذف سؤال التمرين هذا؟')) return;
                    try {
                        const res = await fetch(`/api/exercises/${exItem.id}`, { method: 'DELETE' });
                        const data = await res.json();
                        if (data.success) {
                            curriculumData = data.curriculum;
                            if (currentUnit) currentUnit = curriculumData.units.find(u => u.id === currentUnit.id) || curriculumData.units[0];
                            renderAccordionLessonContent(card, lessonId);
                            showToast('تم حذف سؤال التمرين بنجاح');
                        }
                    } catch (err) {
                        showToast('تعذر حذف سؤال التمرين');
                    }
                });

                exSummary.appendChild(exCard);
            });
        }
    }

    // Render Reinforcement Content in Tab 3
    const reinfSummary = card.querySelector('.studio-reinforcement-summary-card');
    if (reinfSummary) {
        reinfSummary.innerHTML = '';
        const reinfType = lesson.reinforcement_type || 'slides';

        // Update active class on type buttons inside card
        const typeBtns = card.querySelectorAll('.btn-reinf-type');
        typeBtns.forEach(b => {
            if (b.dataset.reinfType === reinfType) {
                b.style.background = '#FFFFFF';
                b.style.color = '#D97706';
                b.style.boxShadow = '0 2px 6px rgba(0,0,0,0.08)';
                b.classList.add('active');
            } else {
                b.style.background = 'transparent';
                b.style.color = '#64748B';
                b.style.boxShadow = 'none';
                b.classList.remove('active');
            }

            b.onclick = async (e) => {
                e.stopPropagation();
                lesson.reinforcement_type = b.dataset.reinfType;
                try {
                    await fetch(`/api/lessons/${lesson.id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ reinforcement_type: lesson.reinforcement_type })
                    });
                } catch (err) {}
                renderAccordionLessonContent(card, lessonId);
            };
        });

        if (reinfType === 'slides') {
            const reinfSlidesList = (lesson.reinforcement_slides && lesson.reinforcement_slides.length > 0)
                ? lesson.reinforcement_slides
                : [
                    {
                        id: 991,
                        welcome_badge: "شريحة تقوية المفاهيم ⚡",
                        title_ar: "ملخص وقاعدة الدرس للتثبيت",
                        description_ar: "شريحة شرح تقوية تفاعلية مخصصة لتثبيت المفاهيم الهامة قبل الاختبار.",
                        image: "/static/images/kids_football.jpg"
                    }
                ];

            const rHeader = document.createElement('div');
            rHeader.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.2rem; flex-wrap: wrap; gap: 1rem;';
            rHeader.innerHTML = `
                <div>
                    <h3 style="margin:0; font-weight:900; color:var(--text-navy);">شرائح الشرح للتقوية (${reinfSlidesList.length})</h3>
                    <p style="margin:0; font-size:0.88rem; color:#64748B;">تظهر هذه الشرائح كجرعة تقوية مركزة للطالب بعد التمرين.</p>
                </div>
                <button type="button" class="btn-add-reinf-slide" style="background: linear-gradient(135deg, #D97706 0%, #B45309 100%); color: #FFF; border: none; padding: 0.7rem 1.3rem; border-radius: 50px; font-weight: 800; cursor: pointer; display: inline-flex; align-items: center; gap: 0.5rem; font-size: 0.92rem;">
                    <i class="fa-solid fa-plus-circle"></i> أضف شريحة تقوية جديدة
                </button>
            `;
            rHeader.querySelector('.btn-add-reinf-slide').onclick = (e) => {
                e.stopPropagation();
                currentLesson = lesson;
                slides = reinfSlidesList;
                const addSlideTemplateModal = document.getElementById('addSlideTemplateModal');
                if (addSlideTemplateModal) addSlideTemplateModal.classList.remove('hidden');
            };
            reinfSummary.appendChild(rHeader);

            reinfSlidesList.forEach((rSlide, rIdx) => {
                const rCard = document.createElement('div');
                rCard.className = 'sequence-slide-card';
                rCard.style.cursor = 'pointer';
                const rNumStr = String(rIdx + 1).padStart(2, '0');

                const exOptionsHtml = lExercises.map((ex, i) => `
                    <option value="${ex.id}" ${rSlide.linked_exercise_id === ex.id ? 'selected' : ''}>
                        سؤال (${i + 1}): ${(ex.question_en || '').substring(0, 28)}...
                    </option>
                `).join('');

                rCard.innerHTML = `
                    <div class="seq-right-section">
                        <div class="seq-index-box" style="background: #FEF3C7; border-color: #FCD34D;">
                            <span class="seq-num" style="color: #92400E;">${rNumStr}</span>
                            <span class="seq-drag-hint" style="color: #D97706;">شرح تقوية ⚡</span>
                        </div>
                        <img src="${rSlide.image || '/static/images/kids_football.jpg'}" alt="صورة الشريحة" class="seq-thumb-img">
                    </div>

                    <div class="seq-info-box">
                        <div class="seq-category" style="background: #FEF3C7; color: #92400E;">${rSlide.welcome_badge || 'تقوية المفاهيم'}</div>
                        <h3 class="seq-title">${rSlide.title_ar || rSlide.title_en || 'شريحة تقوية'}</h3>
                        <p class="seq-desc">${stripHtml(rSlide.description_ar || '')}</p>

                        <div class="reinf-linking-box" style="margin-top: 0.5rem; display: flex; align-items: center; gap: 0.4rem; background: #FFFBEB; padding: 0.35rem 0.7rem; border-radius: 10px; border: 1px solid #FCD34D; flex-wrap: wrap;">
                            <span style="font-weight: 800; font-size: 0.8rem; color: #92400E;"><i class="fa-solid fa-link"></i> تظهر عند الخطأ في:</span>
                            <select class="select-linked-exercise" style="padding: 0.25rem 0.5rem; border-radius: 8px; border: 1px solid #FBBF24; font-weight: 800; font-size: 0.8rem; background: white; color: #78350F; cursor: pointer;">
                                <option value="all" ${(!rSlide.linked_exercise_id || rSlide.linked_exercise_id === 'all') ? 'selected' : ''}>🌐 تظهر للجميع (تقوية عامة)</option>
                                ${exOptionsHtml}
                            </select>
                        </div>
                    </div>

                    <div class="seq-actions-box">
                        <button class="btn-seq-preview btn-preview-reinf-slide">معاينة</button>
                        <button class="btn-seq-edit btn-edit-reinf-slide">تعديل</button>
                        <button class="btn-seq-delete btn-delete-reinf-slide">حذف</button>
                    </div>
                `;

                rCard.addEventListener('click', (e) => {
                    if (e.target.closest('.btn-preview-reinf-slide') || e.target.closest('.btn-delete-reinf-slide') || e.target.closest('.select-linked-exercise')) return;
                    e.stopPropagation();
                    currentLesson = lesson;
                    slides = reinfSlidesList;
                    openEditModal(rSlide, rIdx);
                });

                const selectLinked = rCard.querySelector('.select-linked-exercise');
                if (selectLinked) {
                    selectLinked.addEventListener('change', async (e) => {
                        e.stopPropagation();
                        const val = e.target.value === 'all' ? 'all' : parseInt(e.target.value);
                        rSlide.linked_exercise_id = val;
                        try {
                            await fetch(`/api/lessons/${lesson.id}`, {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ reinforcement_slides: lesson.reinforcement_slides, reinforcement_exercises: lesson.reinforcement_exercises })
                            });
                            showToast('✓ تم ربط التقوية بسؤال التمرين المحدد بنجاح!');
                        } catch (err) {}
                    });
                }

                rCard.querySelector('.btn-preview-reinf-slide').onclick = (e) => {
                    e.stopPropagation();
                    currentLesson = lesson;
                    slides = reinfSlidesList;
                    currentIndex = rIdx;
                    document.getElementById('presentationView').classList.add('active');
                    document.getElementById('studioView').classList.remove('active');
                    document.getElementById('studentDashboardScreen').classList.add('hidden');
                    document.getElementById('exerciseStageContent').classList.add('hidden');
                    document.getElementById('explanationStageContent').classList.remove('hidden');
                    renderCurrentSlide();
                    showToast(`📱 معاينة شريحة التقوية رقم (${rNumStr})`);
                };

                rCard.querySelector('.btn-edit-reinf-slide').onclick = (e) => {
                    e.stopPropagation();
                    currentLesson = lesson;
                    slides = reinfSlidesList;
                    openEditModal(rSlide, rIdx);
                };

                rCard.querySelector('.btn-delete-reinf-slide').onclick = async (e) => {
                    e.stopPropagation();
                    if (!confirm('هل أنت تأكد من حذف شريحة التقوية هذه؟')) return;
                    lesson.reinforcement_slides.splice(rIdx, 1);
                    try {
                        await fetch(`/api/lessons/${lesson.id}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ reinforcement_slides: lesson.reinforcement_slides })
                        });
                        renderAccordionLessonContent(card, lessonId);
                        showToast('تم حذف شريحة التقوية بنجاح');
                    } catch (err) {}
                };

                reinfSummary.appendChild(rCard);
            });
        } else {
            // Exercise Reinforcement Mode
            const reinfExList = (lesson.reinforcement_exercises && lesson.reinforcement_exercises.length > 0)
                ? lesson.reinforcement_exercises
                : [
                    {
                        id: 992,
                        instruction_badge: "تمرين تقوية إضافي ⚡",
                        sentence_ar: "اختر الكلمة المناسبة لتثبيت القاعدة.",
                        question_en: "They _____ football in the club.",
                        options: ["plays", "play", "playing"],
                        correct_index: 1,
                        explanation: "نستخدم play مجرداً مع الضمير الجمع They."
                    }
                ];

            const rHeader = document.createElement('div');
            rHeader.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.2rem; flex-wrap: wrap; gap: 1rem;';
            rHeader.innerHTML = `
                <div>
                    <h3 style="margin:0; font-weight:900; color:var(--text-navy);">أسئلة تمرين التقوية (${reinfExList.length})</h3>
                    <p style="margin:0; font-size:0.88rem; color:#64748B;">تظهر هذه الأسئلة كجرعة تطبيق إضافية لتثبيت الفهم.</p>
                </div>
                <button type="button" class="btn-add-reinf-ex" style="background: linear-gradient(135deg, #D97706 0%, #B45309 100%); color: #FFF; border: none; padding: 0.7rem 1.3rem; border-radius: 50px; font-weight: 800; cursor: pointer; display: inline-flex; align-items: center; gap: 0.5rem; font-size: 0.92rem;">
                    <i class="fa-solid fa-plus-circle"></i> أضف سؤال تقوية جديد
                </button>
            `;
            rHeader.querySelector('.btn-add-reinf-ex').onclick = (e) => {
                e.stopPropagation();
                currentLesson = lesson;
                const addExerciseTemplateModal = document.getElementById('addExerciseTemplateModal');
                if (addExerciseTemplateModal) addExerciseTemplateModal.classList.remove('hidden');
            };
            reinfSummary.appendChild(rHeader);

            reinfExList.forEach((rEx, rIdx) => {
                const rCard = document.createElement('div');
                rCard.className = 'sequence-slide-card';
                rCard.style.cursor = 'pointer';
                const rNumStr = String(rIdx + 1).padStart(2, '0');

                const exOptionsHtml = lExercises.map((ex, i) => `
                    <option value="${ex.id}" ${rEx.linked_exercise_id === ex.id ? 'selected' : ''}>
                        سؤال (${i + 1}): ${(ex.question_en || '').substring(0, 28)}...
                    </option>
                `).join('');

                rCard.innerHTML = `
                    <div class="seq-right-section">
                        <div class="seq-index-box" style="background: #FEF3C7; border-color: #FCD34D;">
                            <span class="seq-num" style="color: #92400E;">${rNumStr}</span>
                            <span class="seq-drag-hint" style="color: #D97706;">تمرين تقوية ⚡</span>
                        </div>
                        <img src="${rEx.image || '/static/images/kids_football.jpg'}" alt="صورة التمرين" class="seq-thumb-img">
                    </div>

                    <div class="seq-info-box">
                        <div class="seq-category" style="background: #FEF3C7; color: #92400E;">${rEx.instruction_badge || 'تمرين تقوية'}</div>
                        <h3 class="seq-title" style="direction: ltr; text-align: left; font-family: 'Outfit', sans-serif;">${rEx.question_en}</h3>

                        <div class="reinf-linking-box" style="margin-top: 0.5rem; display: flex; align-items: center; gap: 0.4rem; background: #FFFBEB; padding: 0.35rem 0.7rem; border-radius: 10px; border: 1px solid #FCD34D; flex-wrap: wrap;">
                            <span style="font-weight: 800; font-size: 0.8rem; color: #92400E;"><i class="fa-solid fa-link"></i> تظهر عند الخطأ في:</span>
                            <select class="select-linked-exercise" style="padding: 0.25rem 0.5rem; border-radius: 8px; border: 1px solid #FBBF24; font-weight: 800; font-size: 0.8rem; background: white; color: #78350F; cursor: pointer;">
                                <option value="all" ${(!rEx.linked_exercise_id || rEx.linked_exercise_id === 'all') ? 'selected' : ''}>🌐 تظهر للجميع (تقوية عامة)</option>
                                ${exOptionsHtml}
                            </select>
                        </div>
                    </div>

                    <div class="seq-actions-box">
                        <button class="btn-seq-preview btn-preview-reinf-ex">🧪 تجربة</button>
                        <button class="btn-seq-edit btn-edit-reinf-ex">تعديل</button>
                        <button class="btn-seq-delete btn-delete-reinf-ex">حذف</button>
                    </div>
                `;

                rCard.addEventListener('click', (e) => {
                    if (e.target.closest('.btn-preview-reinf-ex') || e.target.closest('.btn-delete-reinf-ex') || e.target.closest('.select-linked-exercise')) return;
                    e.stopPropagation();
                    currentLesson = lesson;
                    currentExercise = rEx;
                    openExerciseEditModal();
                });

                const selectLinked = rCard.querySelector('.select-linked-exercise');
                if (selectLinked) {
                    selectLinked.addEventListener('change', async (e) => {
                        e.stopPropagation();
                        const val = e.target.value === 'all' ? 'all' : parseInt(e.target.value);
                        rEx.linked_exercise_id = val;
                        try {
                            await fetch(`/api/lessons/${lesson.id}`, {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ reinforcement_slides: lesson.reinforcement_slides, reinforcement_exercises: lesson.reinforcement_exercises })
                            });
                            showToast('✓ تم ربط تمرين التقوية بسؤال التمرين المحدد بنجاح!');
                        } catch (err) {}
                    });
                }

                rCard.querySelector('.btn-preview-reinf-ex').onclick = (e) => {
                    e.stopPropagation();
                    runExerciseSimulator({ exercises: reinfExList, title_ar: "تمرين تقوية المفاهيم ⚡" }, rIdx);
                };

                rCard.querySelector('.btn-edit-reinf-ex').onclick = (e) => {
                    e.stopPropagation();
                    currentLesson = lesson;
                    currentExercise = rEx;
                    openExerciseEditModal();
                };

                rCard.querySelector('.btn-delete-reinf-ex').onclick = async (e) => {
                    e.stopPropagation();
                    if (!confirm('هل أنت تأكد من حذف سؤال التقوية هذا؟')) return;
                    lesson.reinforcement_exercises.splice(rIdx, 1);
                    try {
                        await fetch(`/api/lessons/${lesson.id}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ reinforcement_exercises: lesson.reinforcement_exercises })
                        });
                        renderAccordionLessonContent(card, lessonId);
                        showToast('تم حذف سؤال التقوية بنجاح');
                    } catch (err) {}
                };

                reinfSummary.appendChild(rCard);
            });
        }
    }

    // Render Exam Questions in Tab 4
    const examSummary = card.querySelector('.studio-exam-summary-card');
    if (examSummary) {
        examSummary.innerHTML = '';
        const lExamQuestions = lesson.exam_questions || [
            {
                id: 951,
                instruction_badge: "📝 الاختبار النهائي لتقييم الإتقان 🎯",
                sentence_ar: "هو يستمع إلى الموسيقى كل مساء.",
                question_en: "He _____ to music every evening.",
                options: ["listens", "listen", "listening"],
                correct_index: 0,
                explanation: "نستخدم listens مضافاً إليها s لأن الفاعل مفرد He في حالة الإثبات.",
                image: "/static/images/kids_football.jpg"
            }
        ];

        const eqHeader = document.createElement('div');
        eqHeader.style.cssText = 'display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem;';
        eqHeader.innerHTML = `
            <div>
                <span class="sub-badge-teal" style="background: #ECFDF5; color: #047857; border: 1px solid #A7F3D0;">أسئلة الاختبار النهائي (${lExamQuestions.length})</span>
                <h2 style="font-size: 1.6rem; font-weight: 900; color: var(--text-navy); margin: 0.2rem 0;">اختبار إتقان الدرس النهائي (Mastery Quiz)</h2>
                <p class="tab-explanation-sub" style="margin: 0;">تعديل وترتيب وتجربة أسئلة الاختبار النهائي للتأكد من إتقان الطالب المفهوم 100%.</p>
            </div>
            <div style="display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap;">
                <button type="button" class="btn-test-all-exam-questions" style="background: linear-gradient(135deg, #059669 0%, #047857 100%); color: #FFF; border: none; padding: 0.77rem 1.4rem; border-radius: 50px; font-weight: 800; cursor: pointer; display: inline-flex; align-items: center; gap: 0.5rem; box-shadow: 0 4px 14px rgba(5, 150, 105, 0.3); font-family: inherit; font-size: 0.95rem;">
                    <i class="fa-solid fa-award"></i> 📝 تجربة واختبار النهائي (كطالب)
                </button>
                <button type="button" class="btn-add-exam-q" style="background: linear-gradient(135deg, #0D9488 0%, #0F766E 100%); color: #FFF; border: none; padding: 0.77rem 1.4rem; border-radius: 50px; font-weight: 800; cursor: pointer; display: inline-flex; align-items: center; gap: 0.5rem; box-shadow: 0 4px 14px rgba(13, 148, 136, 0.3); font-family: inherit; font-size: 0.95rem;">
                    <i class="fa-solid fa-plus-circle"></i> أضف سؤال اختبار جديد
                </button>
            </div>
        `;

        eqHeader.querySelector('.btn-test-all-exam-questions').onclick = (e) => {
            e.stopPropagation();
            currentLesson = lesson;
            triggerStudentExamStage();
        };

        eqHeader.querySelector('.btn-add-exam-q').onclick = (e) => {
            e.stopPropagation();
            currentLesson = lesson;
            const addExerciseTemplateModal = document.getElementById('addExerciseTemplateModal');
            if (addExerciseTemplateModal) addExerciseTemplateModal.classList.remove('hidden');
        };

        examSummary.appendChild(eqHeader);

        lExamQuestions.forEach((eqItem, eqIdx) => {
            const eqCard = document.createElement('div');
            eqCard.className = 'sequence-slide-card';
            eqCard.style.cursor = 'pointer';
            const eqNumStr = String(eqIdx + 1).padStart(2, '0');

            eqCard.innerHTML = `
                <div class="seq-right-section">
                    <div class="seq-index-box">
                        <span class="seq-num">${eqNumStr}</span>
                        <span class="seq-drag-hint" style="background: #ECFDF5; color: #047857;">اختبار نهائي 📝</span>
                    </div>
                    <img src="${eqItem.image || '/static/images/kids_football.jpg'}" alt="صورة الاختبار" class="seq-thumb-img">
                </div>

                <div class="seq-info-box">
                    <div class="seq-category" style="background: #ECFDF5; color: #047857;">${eqItem.instruction_badge || 'سؤال اختبار نهائي'}</div>
                    <h3 class="seq-title" style="direction: ltr; text-align: left; font-family: 'Outfit', sans-serif;">${eqItem.question_en}</h3>
                    <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.4rem;">
                        ${eqItem.options.map((opt, i) => `
                            <span style="background: ${i === eqItem.correct_index ? '#D1FAE5' : '#F8FAFC'}; border: 1px solid ${i === eqItem.correct_index ? '#10B981' : '#CBD5E1'}; color: ${i === eqItem.correct_index ? '#065F46' : 'var(--text-navy)'}; padding: 0.2rem 0.6rem; border-radius: 8px; font-weight: 800; font-size: 0.8rem; font-family: 'Outfit', sans-serif;">
                                ${opt} ${i === eqItem.correct_index ? '✓' : ''}
                            </span>
                        `).join('')}
                    </div>
                </div>

                <div class="seq-actions-box">
                    <button class="btn-seq-preview btn-preview-eq-item">🧪 تجربة</button>
                    <button class="btn-seq-edit btn-edit-eq-item">تعديل</button>
                    <button class="btn-seq-delete btn-delete-eq-item">حذف</button>
                </div>
            `;

            eqCard.addEventListener('click', (e) => {
                if (e.target.closest('.btn-preview-eq-item') || e.target.closest('.btn-delete-eq-item')) return;
                e.stopPropagation();
                currentLesson = lesson;
                currentExercise = eqItem;
                openExerciseEditModal();
            });

            eqCard.querySelector('.btn-preview-eq-item').onclick = (e) => {
                e.stopPropagation();
                runExerciseSimulator({ exercises: [eqItem], title_ar: "📝 تجربة سؤال الاختبار النهائي" }, 0);
            };

            eqCard.querySelector('.btn-edit-eq-item').onclick = (e) => {
                e.stopPropagation();
                currentLesson = lesson;
                currentExercise = eqItem;
                openExerciseEditModal();
            };

            eqCard.querySelector('.btn-delete-eq-item').onclick = async (e) => {
                e.stopPropagation();
                if (!confirm('هل أنت تأكد من حذف سؤال الاختبار النهائي هذا؟')) return;
                try {
                    const res = await fetch(`/api/exam_questions/${eqItem.id}`, { method: 'DELETE' });
                    const data = await res.json();
                    if (data.success) {
                        curriculumData = data.curriculum;
                        renderAccordionLessonContent(card, lessonId);
                        showToast('تم حذف سؤال الاختبار بنجاح');
                    }
                } catch (err) {}
            };

            examSummary.appendChild(eqCard);
        });
    }
}

// Create New Slide with Template
async function createNewSlideWithTemplate(templateType) {
    let newSlideData = {
        title_ar: "شريحة جديدة",
        title_en: "New Slide",
        description_ar: "اكتب الشرح الموجه للطلاب هنا...",
        description_en: "Add your english explanation subtitle here...",
        teacher_notes: "",
        blocks_order: ['badge_title', 'description', 'image_box', 'rule_box', 'example_box'],
        lesson_id: (currentLesson ? currentLesson.id : 101)
    };

    if (templateType === 'rule') {
        newSlideData.welcome_badge = "شرح قاعدة جديدة";
        newSlideData.rule_title = "Subject + Verb(s/es)";
        newSlideData.rule_desc = "مع المفرد نضيف s أو es للفعل المضارع.";
        newSlideData.example_en = "She plays tennis every afternoon.";
        newSlideData.example_ar = "هي تلعب التنس كل يوم بعد الظهر.";
        newSlideData.image = "/static/images/girl_school.jpg";
    } else if (templateType === 'quiz' || templateType === 'discovery' || templateType === 'two_stage') {
        newSlideData.template_type = "two_stage";
        newSlideData.welcome_badge = "تمرين واختبار تفاعلي";
        newSlideData.title_ar = "اختبر معلوماتك في القاعدة";
        newSlideData.description_ar = "اختر الإجابة الصحيحة لإظهار النتيجة وكشف القاعدة فوراً.";
        newSlideData.scene_badge = "سؤال تفاعلي ✏️";
        newSlideData.question_ar = "She _____ to school every morning.";
        newSlideData.options = ["goes", "go", "going"];
        newSlideData.correct_index = 0;
        newSlideData.hint_note = "انتبه لحرف (es) مع الضمير المفرد She.";
        newSlideData.result_title = "إجابة صحيحة ممتازة! 🎉";
        newSlideData.reveal_badge = "She + goes";
        newSlideData.reveal_explanation = "إجابة رائعة! الفاعل المفرد She يأخذ الفعل مضافاً إليه es.";
        newSlideData.wrong_note = "تذكر أن الفاعل المفرد She يتطلب إضافة es للفعل.";
        newSlideData.image = "/static/images/girl_school.jpg";
        newSlideData.blocks_order = ['two_stage_block'];
    } else if (templateType === 'visual') {
        newSlideData.welcome_badge = "وسائط وسيناريو 3D";
        newSlideData.title_en = "Daily Routine";
        newSlideData.example_en = "We play football every Friday.";
        newSlideData.example_ar = "نحن نلعب كرة القدم كل يوم جمعة.";
        newSlideData.image = "/static/images/kids_football.jpg";
    } else if (templateType === 'audio') {
        newSlideData.welcome_badge = "تدريب استماع";
        newSlideData.title_en = "Listen & Repeat";
        newSlideData.example_en = "He eats a healthy breakfast every day.";
        newSlideData.example_ar = "هو يأكل إفطاراً صحياً كل يوم.";
        newSlideData.image = "/static/images/child_breakfast.jpg";
        newSlideData.blocks_order = ['badge_title', 'description', 'image_box', 'example_box'];
    }

    try {
        const res = await fetch('/api/slides', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newSlideData)
        });
        const data = await res.json();
        if (data.success) {
            const expandedCard = document.querySelector('.lesson-manager-card.expanded');
            const lessonId = expandedCard ? parseInt(expandedCard.dataset.lessonId) : (currentLesson ? currentLesson.id : null);
            syncCurriculumState(data.curriculum, lessonId);

            if (expandedCard) {
                renderAccordionLessonContent(expandedCard, lessonId);
            }
            showToast('✨ تم إضافة الشريحة للدرس بنجاح ويتم عرض جميع الشرائح الآن!');
        }
    } catch (err) {
        showToast('تعذر إنشاء الشريحة الجديدة');
    }
}

// Load curriculum from server
async function loadCurriculum() {
    try {
        const res = await fetch('/api/curriculum');
        const data = await res.json();
        if (data.success && data.curriculum.units.length > 0) {
            curriculumData = data.curriculum;
            currentUnit = curriculumData.units[0];
            currentLesson = currentUnit.lessons[0];
            slides = currentLesson.slides;
            currentExercise = currentLesson.exercise;
        }
    } catch (err) {
        console.error('Error loading curriculum:', err);
    }
}

// Show Student Dashboard Screen
function showStudentDashboard() {
    document.getElementById('studentDashboardScreen').classList.remove('hidden');
    document.getElementById('explanationStageContent').classList.add('hidden');
    document.getElementById('exerciseStageContent').classList.add('hidden');
}

// Open Specific Lesson from Student Dashboard
function openLesson(lessonId) {
    if (!currentUnit) return;
    const foundLesson = currentUnit.lessons.find(l => l.id === lessonId);
    if (foundLesson) {
        currentLesson = foundLesson;
        slides = currentLesson.slides;
        currentExercise = currentLesson.exercise;
        currentIndex = 0;

        document.getElementById('studentDashboardScreen').classList.add('hidden');
        document.getElementById('exerciseStageContent').classList.add('hidden');
        document.getElementById('explanationStageContent').classList.remove('hidden');
        renderCurrentSlide();
    }
}

// Render Current Presentation Slide
function renderCurrentSlide() {
    if (!slides || slides.length === 0) return;
    const slide = slides[currentIndex];

    document.getElementById('currentSlideNum').textContent = currentIndex + 1;
    document.getElementById('totalSlidesNum').textContent = slides.length;

    const progressBar = document.getElementById('segmentedProgressBar');
    progressBar.innerHTML = '';
    slides.forEach((_, idx) => {
        const seg = document.createElement('div');
        seg.className = `progress-segment ${idx <= currentIndex ? 'active' : ''}`;
        progressBar.appendChild(seg);
    });

    document.getElementById('prevSlideBtn').disabled = (currentIndex === 0);
    const nextBtn = document.getElementById('nextSlideBtn');
    if (currentIndex === slides.length - 1) {
        nextBtn.innerHTML = `<span>بدء التمرين التفاعلي</span> <i class="fa-solid fa-arrow-left"></i>`;
    } else {
        nextBtn.innerHTML = `<span>التالي</span> <i class="fa-solid fa-arrow-left"></i>`;
    }

    const screenContent = document.getElementById('studentScreenContent');
    const order = slide.blocks_order || ['badge_title', 'description', 'image_box', 'rule_box', 'example_box'];
    screenContent.innerHTML = renderBlocksHtmlForData(slide, order);
}

// Render HTML Blocks for Slide Data
function renderBlocksHtmlForData(slide, blockOrder) {
    let html = '';
    blockOrder.forEach(blockType => {
        if (blockType === 'badge_title') {
            const titleHtml = (slide.title_en || 'Present Simple').replace(/\n/g, '<br>');
            html += `
                <div class="welcome-badge">${slide.welcome_badge || 'مرحباً بك في أهم درس'}</div>
                <h1 class="hero-title-en">${titleHtml}</h1>
            `;
        } else if (blockType === 'description') {
            html += `
                <div class="desc-block">
                    <div class="desc-ar-text">${slide.description_ar || ''}</div>
                    <div class="desc-en-text">${slide.description_en || ''}</div>
                </div>
            `;
        } else if (blockType === 'image_box' && slide.image) {
            html += `
                <div class="mobile-image-frame">
                    <img src="${slide.image}" alt="صورة الشريحة" class="mobile-slide-img">
                </div>
            `;
        } else if (blockType === 'rule_box') {
            html += `
                <div class="light-card rule-card">
                    <div class="card-label label-teal">تركيب القاعدة</div>
                    <div class="rule-title">${slide.rule_title || 'Subject + Verb + Object'}</div>
                    <div class="rule-desc">${slide.rule_desc || ''}</div>
                </div>
            `;
        } else if (blockType === 'example_box') {
            html += `
                <div class="light-card example-card">
                    <div class="card-label label-peach">مثال</div>
                    <div class="example-en">${slide.example_en || ''}</div>
                    <div class="example-ar">${slide.example_ar || ''}</div>
                </div>
            `;
        } else if (blockType === 'discovery_block') {
            const opts = slide.options || ["ولد واحد", "بنت واحدة", "حيوان أو شيء واحد", "أكثر من واحد"];
            html += `
                <div class="discovery-template-wrapper" id="discoveryWrapper_${slide.id || 0}">
                    <div class="discovery-top-nav-bar">
                        <span class="discovery-header-tag">${slide.welcome_badge || 'طريقة شرح تفاعلية'}</span>
                        <button class="btn-discovery-options-header">خيارات الشرح ➔</button>
                    </div>

                    <h2 class="discovery-main-title">🧭 ${slide.title_ar || 'اكتشف القاعدة بنفسك'}</h2>
                    <div class="discovery-sub-desc">${slide.description_ar || 'انظر إلى المشهد أولاً، ثم حدد ما الذي تراه.'}</div>

                    <div class="discovery-scene-badge">${slide.scene_badge || 'المشهد 1 من 4'}</div>

                    ${slide.image ? `
                        <div class="mobile-image-frame" style="margin-bottom: 0.8rem;">
                            <img src="${slide.image}" alt="صورة المشهد" class="mobile-slide-img">
                        </div>
                    ` : ''}

                    <div id="discoveryQuestionStage_${slide.id || 0}">
                        <h3 class="discovery-question-title">${slide.question_ar || 'ماذا ترى في الصورة؟'}</h3>
                        <div class="discovery-options-grid-2x2">
                            ${opts.map((opt, i) => `
                                <button type="button" class="btn-discovery-option" onclick="triggerDiscoveryReveal(${slide.id || 0}, ${i})">${opt}</button>
                            `).join('')}
                        </div>
                        <div class="discovery-footer-hint">ابدأ بالعدد: هل ترى واحداً أم أكثر؟</div>
                    </div>

                    <div id="discoveryResultStage_${slide.id || 0}" class="hidden">
                        <div class="discovery-result-card">
                            <div class="discovery-result-header">${slide.result_title || 'أحسنت! اكتشفت الضمير'}</div>
                            <div class="discovery-reveal-pronoun">${slide.reveal_badge || 'He'}</div>
                            <div class="discovery-reveal-explanation">${slide.reveal_explanation || 'نستخدم He للولد أو الرجل الواحد.'}</div>
                            <div class="discovery-reveal-note">${slide.reveal_note || 'المشهد يدل على: ولد واحد'}</div>
                        </div>

                        <button type="button" class="btn-discovery-next-scene" onclick="resetDiscoveryStage(${slide.id || 0})">
                            الضمير التالي <i class="fa-solid fa-arrow-left"></i>
                        </button>
                    </div>
                </div>
            `;
        } else if (blockType === 'two_stage_block') {
            const opts = slide.options || ["He plays football.", "He play football.", "He playing football."];
            html += `
                <div class="two-stage-template-wrapper" id="twoStageWrapper_${slide.id || 0}">
                    <div class="discovery-top-nav-bar">
                        <span class="discovery-header-tag">${slide.welcome_badge || 'اكتشف القاعدة بنفسك'}</span>
                        <span class="discovery-scene-badge" style="margin:0;">${slide.scene_badge || 'المشهد 1 من 4'}</span>
                    </div>

                    <!-- Interactive Stage Switcher Bar for Quick Preview -->
                    <div class="stage-switcher-tabs" style="display: flex; gap: 0.4rem; margin: 0.6rem 0; background: #E2E8F0; padding: 0.25rem; border-radius: 12px;">
                        <button type="button" id="tabStage1Btn_${slide.id || 0}" class="btn-stage-tab active" onclick="showStage1(${slide.id || 0})" style="flex:1; border:none; padding:0.35rem 0.5rem; border-radius:9px; font-weight:800; font-size:0.75rem; cursor:pointer; background:#FFFFFF; color:#0D9488; box-shadow: 0 2px 4px rgba(0,0,0,0.08);">1️⃣ المرحلة 1: التخمين</button>
                        <button type="button" id="tabStage2Btn_${slide.id || 0}" class="btn-stage-tab" onclick="showStage2(${slide.id || 0})" style="flex:1; border:none; padding:0.35rem 0.5rem; border-radius:9px; font-weight:800; font-size:0.75rem; cursor:pointer; background:transparent; color:#475569;">2️⃣ المرحلة 2: كشف القاعدة 🎁</button>
                    </div>

                    <h2 class="discovery-main-title">${slide.title_ar || 'الدرس الأول: المضارع البسيط في حالة الإثبات'}</h2>
                    <div class="discovery-sub-desc">${slide.description_ar || ''}</div>

                    ${slide.image ? `
                        <div class="mobile-image-frame" style="margin-bottom: 0.8rem;">
                            <img src="${slide.image}" alt="صورة المشهد" class="mobile-slide-img">
                        </div>
                    ` : ''}

                    <div id="twoStageQuestion_${slide.id || 0}">
                        <h3 class="discovery-question-title">${slide.question_ar || 'اختر الجملة الصحيحة للصورة.'}</h3>
                        <div class="two-stage-options-list">
                            ${opts.map((opt, i) => `
                                <button type="button" class="btn-two-stage-opt ${i === (slide.correct_index || 0) ? 'highlight-option' : ''}" onclick="triggerTwoStageReveal(${slide.id || 0}, ${i})">${opt}</button>
                            `).join('')}
                        </div>
                        <div id="twoStageWrongFeedback_${slide.id || 0}" class="two-stage-wrong-alert hidden" style="background: #FEF2F2; border: 1.5px solid #FCA5A5; color: #991B1B; padding: 0.6rem 0.8rem; border-radius: 12px; margin-top: 0.6rem; font-size: 0.75rem; font-weight: 700; display: flex; align-items: center; gap: 0.4rem;">
                            <i class="fa-solid fa-triangle-exclamation" style="color: #DC2626; font-size: 0.9rem;"></i>
                            <span id="twoStageWrongText_${slide.id || 0}">${slide.wrong_note || 'تذكر أن الفاعل المفرد He يحتاج الفعل مضافاً إليه s.'}</span>
                        </div>
                        <div class="discovery-footer-hint">${slide.hint_note || 'ابحث عن He ثم راقب نهاية الفعل.'}</div>
                    </div>

                    <div id="twoStageResult_${slide.id || 0}" class="hidden">
                        <div class="discovery-result-card">
                            <div class="discovery-result-header">${slide.result_title || 'أحسنت! ظهرت القاعدة'}</div>
                            <div class="discovery-reveal-pronoun" style="font-size: 2.2rem; color: #0D9488;">${slide.reveal_badge || 'He + plays'}</div>
                            <div class="discovery-reveal-explanation">${slide.reveal_explanation || 'ممتاز! لاحظت أن He يحتاج الفعل مع s.'}</div>
                        </div>

                        <button type="button" class="btn-discovery-next-scene" onclick="advanceToNextSlideFromTwoStage()" style="margin-top: 0.8rem;">
                            المشهد التالي <i class="fa-solid fa-arrow-left"></i>
                        </button>
                    </div>
                </div>
            `;
        }
    });
    return html;
}

function showStage1(slideId) {
    const qStage = document.getElementById(`twoStageQuestion_${slideId}`);
    const rStage = document.getElementById(`twoStageResult_${slideId}`);
    const b1 = document.getElementById(`tabStage1Btn_${slideId}`);
    const b2 = document.getElementById(`tabStage2Btn_${slideId}`);
    if (qStage) qStage.classList.remove('hidden');
    if (rStage) rStage.classList.add('hidden');
    if (b1) { b1.style.background = '#FFFFFF'; b1.style.color = '#0D9488'; }
    if (b2) { b2.style.background = 'transparent'; b2.style.color = '#475569'; }
}

function showStage2(slideId) {
    const qStage = document.getElementById(`twoStageQuestion_${slideId}`);
    const rStage = document.getElementById(`twoStageResult_${slideId}`);
    const b1 = document.getElementById(`tabStage1Btn_${slideId}`);
    const b2 = document.getElementById(`tabStage2Btn_${slideId}`);
    if (qStage) qStage.classList.add('hidden');
    if (rStage) rStage.classList.remove('hidden');
    if (b2) { b2.style.background = '#FFFFFF'; b2.style.color = '#0D9488'; }
    if (b1) { b1.style.background = 'transparent'; b1.style.color = '#475569'; }
}

function triggerTwoStageReveal(slideId, optionIndex) {
    const targetSlide = (slides && slides.find(s => s.id === slideId)) || { correct_index: 0 };
    const correctIdx = (targetSlide.correct_index !== undefined) ? targetSlide.correct_index : 0;

    const getVal = (id) => {
        const el = document.getElementById(id);
        return el ? el.value.trim() : '';
    };
    const customWrongMsg = getVal('formTwoStageWrongNote') || (targetSlide && targetSlide.wrong_note) || 'تذكر أن الفاعل المفرد He يحتاج الفعل مضافاً إليه s.';

    const optButtons = document.querySelectorAll(`#twoStageQuestion_${slideId} .btn-two-stage-opt`);
    const wrongAlertBox = document.getElementById(`twoStageWrongFeedback_${slideId}`);
    const wrongAlertText = document.getElementById(`twoStageWrongText_${slideId}`);
    
    if (optionIndex === correctIdx) {
        if (wrongAlertBox) wrongAlertBox.classList.add('hidden');
        optButtons.forEach((btn, idx) => {
            if (idx === optionIndex) {
                btn.style.background = '#10B981';
                btn.style.color = '#FFFFFF';
                btn.style.borderColor = '#059669';
            }
        });
        showToast('🎉 إجابة صحيحة! اكتشفت القاعدة ببراعة');
        setTimeout(() => {
            showStage2(slideId);
        }, 500);
    } else {
        optButtons.forEach((btn, idx) => {
            if (idx === optionIndex) {
                btn.style.background = '#FEE2E2';
                btn.style.color = '#DC2626';
                btn.style.borderColor = '#EF4444';
            }
        });
        if (wrongAlertText) wrongAlertText.textContent = customWrongMsg;
        if (wrongAlertBox) {
            wrongAlertBox.classList.remove('hidden');
        }
    }
}

function advanceToNextSlideFromTwoStage() {
    const nextBtn = document.getElementById('nextSlideBtn');
    if (nextBtn) nextBtn.click();
}

// Global Form State Store to preserve typed text across block additions/reordering
let currentFormDataStore = {};

function harvestCurrentFormState() {
    const getVal = (id) => {
        const el = document.getElementById(id);
        return el ? el.value : null;
    };

    const updateStore = (key, val) => {
        if (val !== null && val !== undefined) {
            currentFormDataStore[key] = val;
        }
    };

    updateStore('welcome_badge', getVal('formWelcomeBadge'));
    updateStore('title_ar', getVal('formTitleAr'));
    updateStore('title_en', getVal('formTitleEn'));
    updateStore('description_ar', getVal('formDescriptionAr'));
    updateStore('description_en', getVal('formDescriptionEn'));
    updateStore('rule_title', getVal('formRuleTitle'));
    updateStore('rule_desc', getVal('formRuleDesc'));
    updateStore('example_en', getVal('formExampleEn'));
    updateStore('example_ar', getVal('formExampleAr'));
    updateStore('image_select', getVal('formImageSelect'));
    updateStore('custom_image', getVal('formCustomImageUrl'));
    updateStore('teacher_notes', getVal('formTeacherNotes'));
    updateStore('scene_badge', getVal('formDiscSceneBadge'));
    updateStore('question_ar', getVal('formDiscQuestion'));
    updateStore('disc_opt0', getVal('formDiscOpt0'));
    updateStore('disc_opt1', getVal('formDiscOpt1'));
    updateStore('disc_opt2', getVal('formDiscOpt2'));
    updateStore('disc_opt3', getVal('formDiscOpt3'));
    updateStore('result_title', getVal('formDiscResultTitle'));
    updateStore('reveal_badge', getVal('formDiscRevealBadge'));
    updateStore('reveal_explanation', getVal('formDiscRevealExplanation'));
    updateStore('reveal_note', getVal('formDiscRevealNote'));
    // Two Stage fields
    updateStore('ts_scene_badge', getVal('formTwoStageSceneBadge'));
    updateStore('ts_question', getVal('formTwoStageQuestion'));
    updateStore('ts_opt0', getVal('formTwoStageOpt0'));
    updateStore('ts_opt1', getVal('formTwoStageOpt1'));
    updateStore('ts_opt2', getVal('formTwoStageOpt2'));
    updateStore('ts_hint_note', getVal('formTwoStageHintNote'));
    updateStore('ts_wrong_note', getVal('formTwoStageWrongNote'));
    updateStore('ts_result_title', getVal('formTwoStageResultTitle'));
    updateStore('ts_reveal_badge', getVal('formTwoStageRevealBadge'));
    updateStore('ts_reveal_explanation', getVal('formTwoStageRevealExplanation'));
}

function restoreCurrentFormState() {
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el && val !== undefined) el.value = val;
    };

    setVal('formWelcomeBadge', currentFormDataStore.welcome_badge);
    setVal('formTitleAr', currentFormDataStore.title_ar);
    setVal('formTitleEn', currentFormDataStore.title_en);
    setVal('formDescriptionAr', currentFormDataStore.description_ar);
    setVal('formDescriptionEn', currentFormDataStore.description_en);
    setVal('formRuleTitle', currentFormDataStore.rule_title);
    setVal('formRuleDesc', currentFormDataStore.rule_desc);
    setVal('formExampleEn', currentFormDataStore.example_en);
    setVal('formExampleAr', currentFormDataStore.example_ar);
    setVal('formImageSelect', currentFormDataStore.image_select);
    setVal('formCustomImageUrl', currentFormDataStore.custom_image);
    setVal('formTeacherNotes', currentFormDataStore.teacher_notes);
    setVal('formDiscSceneBadge', currentFormDataStore.scene_badge);
    setVal('formDiscQuestion', currentFormDataStore.question_ar);
    setVal('formDiscOpt0', currentFormDataStore.disc_opt0);
    setVal('formDiscOpt1', currentFormDataStore.disc_opt1);
    setVal('formDiscOpt2', currentFormDataStore.disc_opt2);
    setVal('formDiscOpt3', currentFormDataStore.disc_opt3);
    setVal('formDiscResultTitle', currentFormDataStore.result_title);
    setVal('formDiscRevealBadge', currentFormDataStore.reveal_badge);
    setVal('formDiscRevealExplanation', currentFormDataStore.reveal_explanation);
    setVal('formDiscRevealNote', currentFormDataStore.reveal_note);
    // Two Stage fields
    setVal('formTwoStageSceneBadge', currentFormDataStore.ts_scene_badge);
    setVal('formTwoStageQuestion', currentFormDataStore.ts_question);
    setVal('formTwoStageOpt0', currentFormDataStore.ts_opt0);
    setVal('formTwoStageOpt1', currentFormDataStore.ts_opt1);
    setVal('formTwoStageOpt2', currentFormDataStore.ts_opt2);
    setVal('formTwoStageHintNote', currentFormDataStore.ts_hint_note);
    setVal('formTwoStageWrongNote', currentFormDataStore.ts_wrong_note);
    setVal('formTwoStageResultTitle', currentFormDataStore.ts_result_title);
    setVal('formTwoStageRevealBadge', currentFormDataStore.ts_reveal_badge);
    setVal('formTwoStageRevealExplanation', currentFormDataStore.ts_reveal_explanation);
}

// Render Dynamic Block Editors in Slide Edit Modal
function renderDynamicBlockEditors() {
    const container = document.getElementById('dynamicBlocksContainer');
    if (!container) return;

    // Harvest typed text before clearing DOM
    harvestCurrentFormState();
    container.innerHTML = '';

    activeBlocksOrder.forEach((blockType, idx) => {
        const inserter = document.createElement('div');
        inserter.className = 'inbetween-inserter';
        inserter.innerHTML = `<button type="button" class="btn-inbetween-add" data-idx="${idx}"><i class="fa-solid fa-plus"></i> إضافة عنصر هنا</button>`;
        inserter.querySelector('button').addEventListener('click', () => {
            insertTargetIndex = idx;
            document.getElementById('addBlockMenuModal').classList.remove('hidden');
        });
        container.appendChild(inserter);

        const card = document.createElement('div');
        card.className = 'block-editor-card';
        card.dataset.blockId = blockType;

        let blockTitleHtml = '';
        let fieldsHtml = '';

        if (blockType === 'badge_title') {
            blockTitleHtml = `<i class="fa-solid fa-heading icon-teal"></i> العنوان وعبارة الترحيب`;
            fieldsHtml = `
                <div class="form-row">
                    <div class="form-group">
                        <label>عبارة الترحيب العليا (Badge)</label>
                        <input type="text" id="formWelcomeBadge" placeholder="مرحباً بك في أهم درس">
                    </div>
                    <div class="form-group">
                        <label>اسم الدرس الفرعي (بالعربية)</label>
                        <input type="text" id="formTitleAr" placeholder="المضارع البسيط في حالة الإثبات">
                    </div>
                </div>
                <div class="form-group">
                    <label>العنوان الرئيسي بالإنجليزية (Main Title EN)</label>
                    <textarea id="formTitleEn" rows="2" class="en-font" placeholder="Present&#10;Simple"></textarea>
                </div>
            `;
        } else if (blockType === 'description') {
            blockTitleHtml = `<i class="fa-solid fa-align-right icon-teal"></i> الشرح النصي والترجمة`;
            fieldsHtml = `
                <div class="form-group">
                    <label>الشرح النصي الرئيسي (بالعربية)</label>
                    ${richTextEditorHtml('formDescriptionAr', 'اكتب الشرح الموجه للطلاب هنا...', 'rtl')}
                </div>
                <div class="form-group">
                    <label>الشرح باللغة الإنجليزية (English Subtitle)</label>
                    ${richTextEditorHtml('formDescriptionEn', 'Add your english explanation subtitle here...', 'ltr')}
                </div>
            `;
        } else if (blockType === 'rule_box') {
            blockTitleHtml = `<i class="fa-solid fa-book-open icon-teal"></i> صندوق تركيب القاعدة (Mint Teal)`;
            fieldsHtml = `
                <div class="form-row">
                    <div class="form-group">
                        <label>معادلة القاعدة (Formula Title)</label>
                        <input type="text" id="formRuleTitle" class="en-font" placeholder="Subject + Verb + Object">
                    </div>
                    <div class="form-group">
                        <label>توضيح القاعدة (Explanation)</label>
                        <input type="text" id="formRuleDesc" placeholder="مع I / You / We / They نستخدم الفعل الأساسي...">
                    </div>
                </div>
            `;
        } else if (blockType === 'example_box') {
            blockTitleHtml = `<i class="fa-solid fa-lightbulb icon-peach"></i> صندوق المثال التوضيحي (Warm Peach)`;
            fieldsHtml = `
                <div class="form-row">
                    <div class="form-group">
                        <label>الجملة بالإنجليزية</label>
                        ${richTextEditorHtml('formExampleEn', 'She plays tennis every afternoon.', 'ltr')}
                    </div>
                    <div class="form-group">
                        <label>الترجمة بالعربية</label>
                        ${richTextEditorHtml('formExampleAr', 'هي تلعب التنس كل يوم بعد الظهر.', 'rtl')}
                    </div>
                </div>
            `;
        } else if (blockType === 'image_box') {
            blockTitleHtml = `<i class="fa-solid fa-image icon-blue"></i> الصورة التوضيحية 3D (Pixar Visual)`;
            fieldsHtml = `
                <div class="form-group">
                    <label>اختر صورة الشريحة</label>
                    <select id="formImageSelect">
                        <option value="/static/images/girl_school.jpg">👧 صورة الذهاب للمدرسة (girl_school.jpg)</option>
                        <option value="/static/images/kids_football.jpg">⚽ صورة لعب الكرة (kids_football.jpg)</option>
                        <option value="/static/images/child_breakfast.jpg">🥞 صورة تناول الإفطار (child_breakfast.jpg)</option>
                        <option value="/static/images/routine.jpg">📸 صورة تنظيف الأسنان والروتين (routine.jpg)</option>
                        <option value="/static/images/fact.jpg">🌄 صورة شروق الشمس والحقائق (fact.jpg)</option>
                        <option value="upload">📁 رفع صورة جديدة من جهاز الكمبيوتر...</option>
                        <option value="custom">رابط صورة مخصص...</option>
                        <option value="">بدون صورة</option>
                    </select>
                </div>
                <div id="slideFileUploadContainer" class="form-group hidden" style="background: #F0FDFA; border: 1.5px dashed var(--teal-primary); padding: 1rem; border-radius: 14px; text-align: center;">
                    <label for="formSlideFileUpload" style="color: var(--teal-primary); font-weight: 800; cursor: pointer; display: block;">
                        <i class="fa-solid fa-cloud-arrow-up" style="font-size: 1.6rem; margin-bottom: 0.3rem;"></i><br>
                        انقر هنا لاختيار صورة من جهاز الكمبيوتر الخاص بك
                    </label>
                    <input type="file" id="formSlideFileUpload" accept="image/*" style="display: none;">
                    <span id="slideUploadStatusText" style="font-size: 0.8rem; color: var(--text-muted); font-weight: 700; margin-top: 0.3rem; display: block;">صيغ مدعومة: JPG, PNG, WEBP, GIF</span>
                </div>
                <div id="customUrlContainer" class="form-group hidden">
                    <input type="text" id="formCustomImageUrl" placeholder="https://example.com/image.jpg">
                </div>
            `;
        } else if (blockType === 'discovery_block') {
            blockTitleHtml = `<i class="fa-solid fa-compass icon-emerald"></i> مكون اكتشف القاعدة بنفسك (Guided Discovery)`;
            fieldsHtml = `
                <div class="form-row">
                    <div class="form-group">
                        <label>عنوان الاستكشاف العلوي (Welcome Badge)</label>
                        <input type="text" id="formWelcomeBadge" placeholder="طريقة شرح تفاعلية">
                    </div>
                    <div class="form-group">
                        <label>عنوان القاعدة الرئيسية</label>
                        <input type="text" id="formTitleAr" placeholder="اكتشف القاعدة بنفسك">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>الشرح الوصفي للمشهد</label>
                        <input type="text" id="formDescriptionAr" placeholder="انظر إلى المشهد أولاً، ثم حدد ما الذي تراه.">
                    </div>
                    <div class="form-group">
                        <label>شارة المشهد (Scene Badge)</label>
                        <input type="text" id="formDiscSceneBadge" placeholder="المشهد 1 من 5">
                    </div>
                </div>
                <div class="form-group">
                    <label>السؤال التفاعلي للمشهد</label>
                    <input type="text" id="formDiscQuestion" placeholder="ماذا ترى في الصورة؟">
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>الخيار 1</label>
                        <input type="text" id="formDiscOpt0" placeholder="ولد واحد">
                    </div>
                    <div class="form-group">
                        <label>الخيار 2</label>
                        <input type="text" id="formDiscOpt1" placeholder="بنت واحدة">
                    </div>
                    <div class="form-group">
                        <label>الخيار 3</label>
                        <input type="text" id="formDiscOpt2" placeholder="حيوان أو شيء واحد">
                    </div>
                    <div class="form-group">
                        <label>الخيار 4</label>
                        <input type="text" id="formDiscOpt3" placeholder="أكثر من واحد">
                    </div>
                </div>
                <div class="form-section-card highlight-teal" style="margin-top: 0.5rem;">
                    <div class="section-title"><i class="fa-solid fa-gift"></i> بطاقة نتيجة كشف القاعدة (Result Card)</div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>عنوان النتيجة التشجيعي</label>
                            <input type="text" id="formDiscResultTitle" placeholder="أحسنت! اكتشفت الضمير">
                        </div>
                        <div class="form-group">
                            <label>الرمز المكشوف (Pronoun)</label>
                            <input type="text" id="formDiscRevealBadge" class="en-font" placeholder="He">
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>الشرح المباشر للنتيجة</label>
                            <input type="text" id="formDiscRevealExplanation" placeholder="نستخدم He للولد أو الرجل الواحد.">
                        </div>
                        <div class="form-group">
                            <label>ملاحظة المشهد السفلى</label>
                            <input type="text" id="formDiscRevealNote" placeholder="المشهد يدل على: ولد واحد">
                        </div>
                    </div>
                </div>
            `;
        } else if (blockType === 'two_stage_block') {
            blockTitleHtml = `<i class="fa-solid fa-layer-group icon-emerald"></i> مكون الشريحة المركبة ذات المرحلتين (Two-Stage Compound Slide)`;
            fieldsHtml = `
                <div class="form-row">
                    <div class="form-group">
                        <label>شارة الترحيب العليا (Welcome Badge)</label>
                        <input type="text" id="formWelcomeBadge" placeholder="اكتشف القاعدة بنفسك">
                    </div>
                    <div class="form-group">
                        <label>عنوان القاعدة الرئيسية</label>
                        <input type="text" id="formTitleAr" placeholder="الدرس الأول: المضارع البسيط في حالة الإثبات">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>الوصف والهدف النحوي</label>
                        <input type="text" id="formDescriptionAr" placeholder="أن يكوّن الطالب جملة مثبتة صحيحة...">
                    </div>
                    <div class="form-group">
                        <label>شارة المشهد (Scene Badge)</label>
                        <input type="text" id="formTwoStageSceneBadge" placeholder="المشهد 1 من 4">
                    </div>
                </div>
                <div class="form-group" style="background: #F8FAFC; border: 1.5px solid #CBD5E1; padding: 0.8rem; border-radius: 14px; margin-bottom: 0.8rem;">
                    <label style="font-weight: 800; color: #0D9488;"><i class="fa-solid fa-image"></i> صورة المشهد للشريحة المركبة (اختيار صورة أو رفع من الكمبيوتر)</label>
                    <div class="form-row" style="margin-top: 0.4rem;">
                        <div class="form-group" style="margin:0; flex:1;">
                            <select id="formImageSelect" onchange="handleSlideImageSelectChange(this.value)">
                                <option value="/static/images/kids_football.jpg">⚽ الأطفال يلعبون كرة القدم (kids_football.jpg)</option>
                                <option value="/static/images/girl_reading_library.jpg">📚 البنت تقرأ في المكتبة (girl_reading_library.jpg)</option>
                                <option value="/static/images/girl_school.jpg">🏫 البنت تذهب للمدرسة (girl_school.jpg)</option>
                                <option value="/static/images/child_breakfast.jpg">🥣 الطفل يأكل الإفطار (child_breakfast.jpg)</option>
                                <option value="upload">💻 رفع صورة جديدة من الكمبيوتر</option>
                                <option value="custom">🔗 رابط صورة خارجي مخصص</option>
                            </select>
                        </div>
                        <div class="form-group hidden" id="slideUploadGroup" style="margin:0; flex:1;">
                            <input type="file" id="formSlideFileUpload" accept="image/*" onchange="uploadSlideImageFromPC(this)">
                        </div>
                        <div class="form-group hidden" id="customImageUrlGroup" style="margin:0; flex:1;">
                            <input type="text" id="formCustomImageUrl" placeholder="https://example.com/image.jpg" oninput="updateLivePreview()">
                        </div>
                    </div>
                    <div id="slideUploadStatusText" style="font-size:0.75rem; font-weight:700; color:#0D9488; margin-top:0.4rem;"></div>
                </div>
                <div class="form-group">
                    <label>عنوان السؤال في المرحلة 1 (Question Title)</label>
                    <input type="text" id="formTwoStageQuestion" placeholder="اختر الجملة الصحيحة للصورة.">
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>بطاقة الخيار 1 (الخيار الصحيح)</label>
                        <input type="text" id="formTwoStageOpt0" class="en-font" placeholder="He plays football.">
                    </div>
                    <div class="form-group">
                        <label>بطاقة الخيار 2</label>
                        <input type="text" id="formTwoStageOpt1" class="en-font" placeholder="He play football.">
                    </div>
                    <div class="form-group">
                        <label>بطاقة الخيار 3</label>
                        <input type="text" id="formTwoStageOpt2" class="en-font" placeholder="He playing football.">
                    </div>
                </div>
                <div class="form-section-card" style="margin-top: 0.8rem; background: #FEF2F2; border: 2px solid #FCA5A5; padding: 1rem; border-radius: 14px;">
                    <div class="section-title" style="color: #991B1B; font-weight: 800; font-size: 0.95rem; margin-bottom: 0.6rem;">
                        <i class="fa-solid fa-triangle-exclamation" style="color: #DC2626;"></i> ⚠️ قسم التغذية الراجعة والتنبيه عند الإجابة الخاطئة (Wrong Answer Feedback)
                    </div>
                    <div class="form-row">
                        <div class="form-group" style="margin: 0;">
                            <label style="font-weight: 700; color: #991B1B;">تلميح الملاحظة الدائم (Hint Note)</label>
                            <input type="text" id="formTwoStageHintNote" placeholder="ابحث عن He ثم راقب نهاية الفعل.">
                        </div>
                        <div class="form-group" style="margin: 0;">
                            <label style="font-weight: 700; color: #DC2626;">الرسالة التنبيهية التي تظهر عند خطأ الطالب</label>
                            <input type="text" id="formTwoStageWrongNote" placeholder="تذكر أن الفاعل المفرد He يحتاج الفعل مضافاً إليه s.">
                        </div>
                    </div>
                </div>
                <div class="form-section-card highlight-teal" style="margin-top: 0.5rem;">
                    <div class="section-title"><i class="fa-solid fa-gift"></i> المرحلة 2: بطاقة نتيجة كشف القاعدة (Result Card)</div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>عنوان النتيجة التشجيعي</label>
                            <input type="text" id="formTwoStageResultTitle" placeholder="أحسنت! ظهرت القاعدة">
                        </div>
                        <div class="form-group">
                            <label>الرمز المكشوف والبارز (Pronoun Highlight)</label>
                            <input type="text" id="formTwoStageRevealBadge" class="en-font" placeholder="He + plays">
                        </div>
                    </div>
                    <div class="form-group">
                        <label>الشرح المباشر للقاعدة</label>
                        <input type="text" id="formTwoStageRevealExplanation" placeholder="ممتاز! لاحظت أن He يحتاج الفعل مع s.">
                    </div>
                </div>
            `;
        }

        const isHidden = hiddenBlocksMap[blockType] || false;

        card.innerHTML = `
            <div class="block-header-bar">
                <div class="block-title-tag">${blockTitleHtml}</div>
                <div class="block-controls">
                    <button type="button" class="btn-block-action btn-move-up" title="تحريك لأعلى" ${idx === 0 ? 'disabled' : ''}>⬆️</button>
                    <button type="button" class="btn-block-action btn-move-down" title="تحريك لأسفل" ${idx === activeBlocksOrder.length - 1 ? 'disabled' : ''}>⬇️</button>
                    <button type="button" class="btn-block-action btn-toggle-vis" title="إخفاء/إظهار">${isHidden ? '🙈' : '👁️'}</button>
                    <button type="button" class="btn-block-action delete-btn btn-delete-block" title="حذف العنصر"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
            <div class="block-body-fields ${isHidden ? 'hidden' : ''}">
                ${fieldsHtml}
            </div>
        `;

        card.addEventListener('mouseenter', () => {
            const previewEl = document.querySelector(`.preview-block-item[data-block-id="${blockType}"]`);
            if (previewEl) previewEl.classList.add('preview-highlighted');
        });

        card.addEventListener('mouseleave', () => {
            const previewEl = document.querySelector(`.preview-block-item[data-block-id="${blockType}"]`);
            if (previewEl) previewEl.classList.remove('preview-highlighted');
        });

        card.querySelector('.btn-move-up')?.addEventListener('click', () => {
            if (idx > 0) {
                const temp = activeBlocksOrder[idx];
                activeBlocksOrder[idx] = activeBlocksOrder[idx - 1];
                activeBlocksOrder[idx - 1] = temp;
                renderDynamicBlockEditors();
                updateLivePreview();
            }
        });

        card.querySelector('.btn-move-down')?.addEventListener('click', () => {
            if (idx < activeBlocksOrder.length - 1) {
                const temp = activeBlocksOrder[idx];
                activeBlocksOrder[idx] = activeBlocksOrder[idx + 1];
                activeBlocksOrder[idx + 1] = temp;
                renderDynamicBlockEditors();
                updateLivePreview();
            }
        });

        card.querySelector('.btn-toggle-vis')?.addEventListener('click', () => {
            hiddenBlocksMap[blockType] = !hiddenBlocksMap[blockType];
            renderDynamicBlockEditors();
            updateLivePreview();
        });

        card.querySelector('.btn-delete-block')?.addEventListener('click', () => {
            activeBlocksOrder.splice(idx, 1);
            renderDynamicBlockEditors();
            updateLivePreview();
        });

        container.appendChild(card);
    });

    const inputs = container.querySelectorAll('input, textarea, select');
    inputs.forEach(input => {
        input.addEventListener('input', updateLivePreview);
        input.addEventListener('keyup', updateLivePreview);
        input.addEventListener('change', updateLivePreview);
    });

    const imgSelect = document.getElementById('formImageSelect');
    if (imgSelect) {
        imgSelect.addEventListener('change', (e) => {
            const customContainer = document.getElementById('customUrlContainer');
            if (customContainer) {
                if (e.target.value === 'custom') customContainer.classList.remove('hidden');
                else customContainer.classList.add('hidden');
            }
            updateLivePreview();
        });
    }

    // Restore typed text back into newly created DOM inputs
    restoreCurrentFormState();
    initRichTextEditors(container);
}

// Open Edit Slide Modal Dialog
function openEditModal(slide, idx) {
    if (!slide) return;
    currentSlide = slide;
    document.getElementById('formSlideId').value = slide.id;

    if (slide.blocks_order && slide.blocks_order.length > 0) {
        activeBlocksOrder = [...slide.blocks_order];
    } else {
        activeBlocksOrder = ['badge_title', 'description', 'image_box', 'rule_box', 'example_box'];
    }

    currentFormDataStore = {
        welcome_badge: slide.welcome_badge || '',
        title_ar: slide.title_ar || '',
        title_en: slide.title_en || '',
        description_ar: slide.description_ar || '',
        description_en: slide.description_en || '',
        rule_title: slide.rule_title || '',
        rule_desc: slide.rule_desc || '',
        example_en: slide.example_en || '',
        example_ar: slide.example_ar || '',
        image_select: ['/static/images/girl_school.jpg', '/static/images/kids_football.jpg', '/static/images/child_breakfast.jpg', '/static/images/routine.jpg', '/static/images/fact.jpg'].includes(slide.image) ? slide.image : (slide.image ? 'custom' : ''),
        custom_image: slide.image || '',
        teacher_notes: slide.teacher_notes || '',
        scene_badge: slide.scene_badge || 'المشهد 1 من 5',
        question_ar: slide.question_ar || 'ماذا ترى في الصورة؟',
        disc_opt0: (slide.options && slide.options[0]) || 'ولد واحد',
        disc_opt1: (slide.options && slide.options[1]) || 'بنت واحدة',
        disc_opt2: (slide.options && slide.options[2]) || 'حيوان أو شيء واحد',
        disc_opt3: (slide.options && slide.options[3]) || 'أكثر من واحد',
        result_title: slide.result_title || 'أحسنت! اكتشفت الضمير',
        reveal_badge: slide.reveal_badge || 'He',
        reveal_explanation: slide.reveal_explanation || 'نستخدم He للولد أو الرجل الواحد.',
        reveal_note: slide.reveal_note || 'المشهد يدل على: ولد واحد',
        ts_scene_badge: slide.scene_badge || 'المشهد 1 من 4',
        ts_question: slide.question_ar || 'اختر الجملة الصحيحة للصورة.',
        ts_opt0: (slide.options && slide.options[0]) || 'He plays football.',
        ts_opt1: (slide.options && slide.options[1]) || 'He play football.',
        ts_opt2: (slide.options && slide.options[2]) || 'He playing football.',
        ts_hint_note: slide.hint_note || 'ابحث عن He ثم راقب نهاية الفعل.',
        ts_wrong_note: slide.wrong_note || 'تذكر أن الفاعل المفرد He يحتاج الفعل مضافاً إليه s.',
        ts_result_title: slide.result_title || 'أحسنت! ظهرت القاعدة',
        ts_reveal_badge: slide.reveal_badge || 'He + plays',
        ts_reveal_explanation: slide.reveal_explanation || 'ممتاز! لاحظت أن He يحتاج الفعل مع s.'
    };

    // Populate Modal Slide Switcher Selector Dropdown
    const selector = document.getElementById('modalSlideSelector');
    if (selector && slides && slides.length > 0) {
        selector.innerHTML = slides.map((s, sIdx) => {
            const title = s.title_ar || s.title_en || `شريحة ${sIdx + 1}`;
            const isSel = (sIdx === idx) ? 'selected' : '';
            return `<option value="${sIdx}" ${isSel}>الشريحة ${String(sIdx + 1).padStart(2, '0')}: ${title.substring(0, 32)}</option>`;
        }).join('');

        selector.onchange = (e) => {
            const newIdx = parseInt(e.target.value);
            if (!isNaN(newIdx) && slides[newIdx]) {
                openEditModal(slides[newIdx], newIdx);
            }
        };
    }

    // Toggle Modal Stage Switcher in Header if this is a Two-Stage Compound Slide
    const stageSwitcherWrapper = document.getElementById('modalStageSwitcherWrapper');
    const isTwoStage = (slide.template_type === 'two_stage') || (slide.blocks_order && slide.blocks_order.includes('two_stage_block'));
    if (stageSwitcherWrapper) {
        if (isTwoStage) {
            stageSwitcherWrapper.classList.remove('hidden');
        } else {
            stageSwitcherWrapper.classList.add('hidden');
        }
    }

    renderDynamicBlockEditors();
    updateLivePreview();
    if (isTwoStage) {
        switchModalStage(1);
    }
    document.getElementById('slideEditModal').classList.remove('hidden');
}

function switchModalStage(stageNum) {
    const b1 = document.getElementById('btnHeaderStage1');
    const b2 = document.getElementById('btnHeaderStage2');
    
    if (stageNum === 1) {
        if (b1) b1.classList.add('active');
        if (b2) b2.classList.remove('active');
        
        const formSlideId = document.getElementById('formSlideId');
        if (formSlideId) {
            const slideId = parseInt(formSlideId.value);
            showStage1(slideId);
        }
    } else if (stageNum === 2) {
        if (b2) b2.classList.add('active');
        if (b1) b1.classList.remove('active');
        
        const formSlideId = document.getElementById('formSlideId');
        if (formSlideId) {
            const slideId = parseInt(formSlideId.value);
            showStage2(slideId);
        }
    }
}

// Render HTML Blocks for Modal Live Preview
function renderBlocksHtmlForModalPreview(slide, blockOrder) {
    let html = '';
    blockOrder.forEach(blockType => {
        if (hiddenBlocksMap[blockType]) return;

        if (blockType === 'badge_title') {
            const titleHtml = (slide.title_en || 'Present Simple').replace(/\n/g, '<br>');
            html += `
                <div class="preview-block-item" data-block-id="badge_title">
                    <div class="welcome-badge" data-field-target="formWelcomeBadge" style="cursor:pointer;">${slide.welcome_badge || 'مرحباً بك في أهم درس'}</div>
                    <h1 class="hero-title-en" data-field-target="formTitleAr" style="cursor:pointer;">${titleHtml}</h1>
                </div>
            `;
        } else if (blockType === 'description') {
            html += `
                <div class="preview-block-item" data-block-id="description">
                    <div class="desc-block">
                        <div class="desc-ar-text" data-field-target="formDescriptionAr" style="cursor:pointer;">${slide.description_ar || ''}</div>
                        <div class="desc-en-text" data-field-target="formDescriptionEn" style="cursor:pointer;">${slide.description_en || ''}</div>
                    </div>
                </div>
            `;
        } else if (blockType === 'image_box' && slide.image) {
            html += `
                <div class="preview-block-item" data-block-id="image_box">
                    <div class="mobile-image-frame" data-field-target="formImageSelect" style="cursor:pointer;">
                        <img src="${slide.image}" alt="صورة الشريحة" class="mobile-slide-img">
                    </div>
                </div>
            `;
        } else if (blockType === 'rule_box') {
            html += `
                <div class="preview-block-item" data-block-id="rule_box">
                    <div class="light-card rule-card">
                        <div class="card-label label-teal">تركيب القاعدة</div>
                        <div class="rule-title" data-field-target="formRuleTitle" style="cursor:pointer;">${slide.rule_title || 'Subject + Verb + Object'}</div>
                        <div class="rule-desc" data-field-target="formRuleDesc" style="cursor:pointer;">${slide.rule_desc || ''}</div>
                    </div>
                </div>
            `;
        } else if (blockType === 'example_box') {
            html += `
                <div class="preview-block-item" data-block-id="example_box">
                    <div class="light-card example-card">
                        <div class="card-label label-peach">مثال</div>
                        <div class="example-en" data-field-target="formExampleEn" style="cursor:pointer;">${slide.example_en || ''}</div>
                        <div class="example-ar" data-field-target="formExampleAr" style="cursor:pointer;">${slide.example_ar || ''}</div>
                    </div>
                </div>
            `;
        } else if (blockType === 'discovery_block') {
            const opts = slide.options || ["ولد واحد", "بنت واحدة", "حيوان أو شيء واحد", "أكثر من واحد"];
            html += `
                <div class="preview-block-item" data-block-id="discovery_block">
                    <div class="discovery-template-wrapper">
                        <div class="discovery-top-nav-bar">
                            <span class="discovery-header-tag">${slide.welcome_badge || 'طريقة شرح تفاعلية'}</span>
                            <button class="btn-discovery-options-header" type="button">خيارات الشرح ➔</button>
                        </div>
                        <h2 class="discovery-main-title">🧭 ${slide.title_ar || 'اكتشف القاعدة بنفسك'}</h2>
                        <div class="discovery-sub-desc">${slide.description_ar || 'انظر إلى المشهد أولاً، ثم حدد ما الذي تراه.'}</div>
                        <div class="discovery-scene-badge">${slide.scene_badge || 'المشهد 1 من 5'}</div>
                        ${slide.image ? `
                            <div class="mobile-image-frame" style="margin-bottom: 0.8rem;">
                                <img src="${slide.image}" alt="صورة المشهد" class="mobile-slide-img">
                            </div>
                        ` : ''}
                        <h3 class="discovery-question-title">${slide.question_ar || 'ماذا ترى في الصورة؟'}</h3>
                        <div class="discovery-options-grid-2x2">
                            ${opts.map(opt => `<button type="button" class="btn-discovery-option">${opt}</button>`).join('')}
                        </div>
                    </div>
                </div>
            `;
        } else if (blockType === 'two_stage_block') {
            const opts = slide.options || ["He plays football.", "He play football.", "He playing football."];
            html += `
                <div class="preview-block-item" data-block-id="two_stage_block">
                    <div class="two-stage-template-wrapper" id="twoStageWrapper_${slide.id || 0}">
                        <div class="discovery-top-nav-bar">
                            <span class="discovery-header-tag" data-field-target="formWelcomeBadge" style="cursor:pointer;">${slide.welcome_badge || 'اكتشف القاعدة بنفسك'}</span>
                            <span class="discovery-scene-badge" data-field-target="formTwoStageSceneBadge" style="margin:0; cursor:pointer;">${slide.scene_badge || 'المشهد 1 من 4'}</span>
                        </div>

                        <!-- Interactive Stage Switcher Bar for Quick Preview -->
                        <div class="stage-switcher-tabs" style="display: flex; gap: 0.4rem; margin: 0.6rem 0; background: #E2E8F0; padding: 0.25rem; border-radius: 12px;">
                            <button type="button" id="tabStage1Btn_${slide.id || 0}" class="btn-stage-tab active" onclick="showStage1(${slide.id || 0})" style="flex:1; border:none; padding:0.35rem 0.5rem; border-radius:99px; font-weight:800; font-size:0.75rem; cursor:pointer; background:#FFFFFF; color:#0D9488; box-shadow: 0 2px 4px rgba(0,0,0,0.08);">1️⃣ المرحلة 1: التخمين</button>
                            <button type="button" id="tabStage2Btn_${slide.id || 0}" class="btn-stage-tab" onclick="showStage2(${slide.id || 0})" style="flex:1; border:none; padding:0.35rem 0.5rem; border-radius:99px; font-weight:800; font-size:0.75rem; cursor:pointer; background:transparent; color:#475569;">2️⃣ المرحلة 2: كشف القاعدة 🎁</button>
                        </div>

                        <h2 class="discovery-main-title" data-field-target="formTitleAr" style="cursor:pointer;">${slide.title_ar || 'الدرس الأول: المضارع البسيط في حالة الإثبات'}</h2>
                        <div class="discovery-sub-desc" data-field-target="formDescriptionAr" style="cursor:pointer;">${slide.description_ar || ''}</div>

                        ${slide.image ? `
                            <div class="mobile-image-frame" data-field-target="formImageSelect" style="margin-bottom: 0.8rem; cursor:pointer;">
                                <img src="${slide.image}" alt="صورة المشهد" class="mobile-slide-img">
                            </div>
                        ` : ''}

                        <div id="twoStageQuestion_${slide.id || 0}">
                            <h3 class="discovery-question-title" data-field-target="formTwoStageQuestion" style="cursor:pointer;">${slide.question_ar || 'اختر الجملة الصحيحة للصورة.'}</h3>
                            <div class="two-stage-options-list">
                                ${opts.map((opt, i) => `
                                    <button type="button" class="btn-two-stage-opt ${i === (slide.correct_index || 0) ? 'highlight-option' : ''}" data-field-target="formTwoStageOpt${i}" onclick="triggerTwoStageReveal(${slide.id || 0}, ${i})">${opt}</button>
                                `).join('')}
                            </div>
                            <div id="twoStageWrongFeedback_${slide.id || 0}" class="two-stage-wrong-alert hidden" data-field-target="formTwoStageWrongNote" style="background: #FEF2F2; border: 1.5px solid #FCA5A5; color: #991B1B; padding: 0.6rem 0.8rem; border-radius: 12px; margin-top: 0.6rem; font-size: 0.75rem; font-weight: 700; display: flex; align-items: center; gap: 0.4rem; cursor:pointer;">
                                <i class="fa-solid fa-triangle-exclamation" style="color: #DC2626; font-size: 0.9rem;"></i>
                                <span id="twoStageWrongText_${slide.id || 0}">${slide.wrong_note || 'تذكر أن الفاعل المفرد He يحتاج الفعل مضافاً إليه s.'}</span>
                            </div>
                            <div class="discovery-footer-hint" data-field-target="formTwoStageHintNote" style="cursor:pointer;">${slide.hint_note || 'ابحث عن He ثم راقب نهاية الفعل.'}</div>
                        </div>

                        <div id="twoStageResult_${slide.id || 0}" class="hidden">
                            <div class="discovery-result-card">
                                <div class="discovery-result-header" data-field-target="formTwoStageResultTitle" style="cursor:pointer;">${slide.result_title || 'أحسنت! ظهرت القاعدة'}</div>
                                <div class="discovery-reveal-pronoun" data-field-target="formTwoStageRevealBadge" style="font-size: 2.2rem; color: #0D9488; cursor:pointer;">${slide.reveal_badge || 'He + plays'}</div>
                                <div class="discovery-reveal-explanation" data-field-target="formTwoStageRevealExplanation" style="cursor:pointer;">${slide.reveal_explanation || 'ممتاز! لاحظت أن He يحتاج الفعل مع s.'}</div>
                            </div>

                            <button type="button" class="btn-discovery-next-scene" onclick="advanceToNextSlideFromTwoStage()" style="margin-top: 0.8rem;">
                                المشهد التالي <i class="fa-solid fa-arrow-left"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }
    });
    return html;
}

// Real-Time Live Smartphone Preview Updater
function updateLivePreview() {
    const liveScreenContent = document.getElementById('livePreviewScreenContent');
    if (!liveScreenContent) return;

    const getVal = (id) => {
        const el = document.getElementById(id);
        return el ? el.value.trim() : '';
    };

    let imgVal = getVal('formImageSelect');
    if (imgVal === 'custom' || imgVal === 'upload') imgVal = getVal('formCustomImageUrl');

    const currentSlideData = {
        id: parseInt(getVal('formSlideId')) || 0,
        welcome_badge: getVal('formWelcomeBadge') || 'اكتشف القاعدة بنفسك',
        title_ar: getVal('formTitleAr') || 'الدرس الأول: المضارع البسيط في حالة الإثبات',
        title_en: getVal('formTitleEn') || 'Present\nSimple',
        description_ar: getVal('formDescriptionAr'),
        description_en: getVal('formDescriptionEn'),
        rule_title: getVal('formRuleTitle') || 'Subject + Verb + Object',
        rule_desc: getVal('formRuleDesc'),
        example_en: getVal('formExampleEn'),
        example_ar: getVal('formExampleAr'),
        image: imgVal || '/static/images/kids_football.jpg',
        scene_badge: getVal('formTwoStageSceneBadge') || getVal('formDiscSceneBadge') || 'المشهد 1 من 4',
        question_ar: getVal('formTwoStageQuestion') || getVal('formDiscQuestion') || 'اختر الجملة الصحيحة للصورة.',
        hint_note: getVal('formTwoStageHintNote') || 'ابحث عن He ثم راقب نهاية الفعل.',
        options: [
            getVal('formTwoStageOpt0') || getVal('formDiscOpt0') || "He plays football.",
            getVal('formTwoStageOpt1') || getVal('formDiscOpt1') || "He play football.",
            getVal('formTwoStageOpt2') || getVal('formDiscOpt2') || "He playing football."
        ],
        result_title: getVal('formTwoStageResultTitle') || getVal('formDiscResultTitle') || 'أحسنت! ظهرت القاعدة',
        reveal_badge: getVal('formTwoStageRevealBadge') || getVal('formDiscRevealBadge') || 'He + plays',
        reveal_explanation: getVal('formTwoStageRevealExplanation') || getVal('formDiscRevealExplanation') || 'ممتاز! لاحظت أن He يحتاج الفعل مع s.',
        reveal_note: getVal('formDiscRevealNote') || 'المشهد يدل على: ولد واحد'
    };

    liveScreenContent.innerHTML = renderBlocksHtmlForModalPreview(currentSlideData, activeBlocksOrder);

    // Granular Element-Level Hover and Click Mapping to Specific Form Group Inputs
    const fieldTargets = liveScreenContent.querySelectorAll('[data-field-target]');
    fieldTargets.forEach(targetEl => {
        const targetInputId = targetEl.dataset.fieldTarget;
        const targetInput = document.getElementById(targetInputId);
        const formGroup = targetInput ? targetInput.closest('.form-group') : null;

        targetEl.addEventListener('mouseenter', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.form-group.field-hover-highlight').forEach(fg => fg.classList.remove('field-hover-highlight'));
            if (formGroup) {
                formGroup.classList.add('field-hover-highlight');
                formGroup.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });

        targetEl.addEventListener('mouseleave', (e) => {
            e.stopPropagation();
            if (formGroup) formGroup.classList.remove('field-hover-highlight');
        });

        targetEl.addEventListener('click', (e) => {
            if (targetInput) {
                const richEditor = document.querySelector(`[data-rich-editor="${targetInputId}"]`);
                if (richEditor) richEditor.focus();
                else targetInput.focus();
                if (formGroup) {
                    formGroup.classList.add('field-hover-highlight');
                    setTimeout(() => formGroup.classList.remove('field-hover-highlight'), 2500);
                }
            }
        });
    });

    const previewItems = liveScreenContent.querySelectorAll('.preview-block-item');
    previewItems.forEach(pItem => {
        const blockId = pItem.dataset.blockId;

        pItem.addEventListener('mouseenter', () => {
            const editorCard = document.querySelector(`.block-editor-card[data-block-id="${blockId}"]`);
            if (editorCard) {
                editorCard.classList.add('hover-highlight');
            }
        });

        pItem.addEventListener('mouseleave', () => {
            const editorCard = document.querySelector(`.block-editor-card[data-block-id="${blockId}"]`);
            if (editorCard) editorCard.classList.remove('hover-highlight');
        });
    });
}

// Apply Theme Palette
function applyThemeToPreview(themeName) {
    const livePhoneFrame = document.getElementById('livePhoneFrame');
    const studentPhoneFrame = document.getElementById('studentPhoneFrame');
    if (livePhoneFrame) livePhoneFrame.className = `full-mini-phone-frame theme-${themeName}`;
    if (studentPhoneFrame) studentPhoneFrame.className = `mobile-phone-frame theme-${themeName}`;
}

function handleSlideImageSelectChange(val) {
    const customGroup = document.getElementById('customImageUrlGroup');
    const uploadGroup = document.getElementById('slideUploadGroup');
    if (val === 'custom') {
        if (customGroup) customGroup.classList.remove('hidden');
        if (uploadGroup) uploadGroup.classList.add('hidden');
    } else if (val === 'upload') {
        if (uploadGroup) uploadGroup.classList.remove('hidden');
        if (customGroup) customGroup.classList.remove('hidden');
    } else {
        if (customGroup) customGroup.classList.add('hidden');
        if (uploadGroup) uploadGroup.classList.add('hidden');
    }
    updateLivePreview();
}

async function uploadSlideImageFromPC(inputEl) {
    const file = inputEl.files[0];
    if (!file) return;
    const statusText = document.getElementById('slideUploadStatusText');
    if (statusText) statusText.textContent = "⏳ جاري رفع الصورة إلى السيرفر...";

    const formData = new FormData();
    formData.append('image_file', file);

    try {
        const res = await fetch('/api/upload_image', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.success) {
            const customUrlInput = document.getElementById('formCustomImageUrl');
            if (customUrlInput) customUrlInput.value = data.image_url;
            if (statusText) statusText.textContent = `✓ تم رفع الصورة بنجاح! (${file.name})`;
            updateLivePreview();
            showToast('🎉 تم رفع الصورة من جهاز الكمبيوتر بنجاح وتطبيقها للمعاينة!');
        }
    } catch (err) {
        if (statusText) statusText.textContent = "❌ فشل رفع الصورة";
        showToast('تعذر رفع الصورة من جهازك');
    }
}

// Exercise Simulator Global State
let currentExerciseIndex = 0;
let exerciseAnswerState = {};
let exerciseReviewState = {};

// Run Exercise Simulator (Test as Student)
function runExerciseSimulator(lessonObj, startIdx = 0) {
    if (!lessonObj) return;
    currentLesson = lessonObj;
    currentExerciseIndex = startIdx || 0;

    const exercisesList = (lessonObj.exercises && lessonObj.exercises.length > 0) 
        ? lessonObj.exercises 
        : (lessonObj.exercise ? [lessonObj.exercise] : []);

    if (exercisesList.length === 0) {
        showToast('لا توجد تمارين مضافة في هذا الدرس بعد!');
        return;
    }

    // Switch main view from Studio to Presentation mode
    const presentationView = document.getElementById('presentationView');
    const studioView = document.getElementById('studioView');
    if (studioView) studioView.classList.remove('active');
    if (presentationView) presentationView.classList.add('active');

    // Switch top navbar tab highlights
    const topNavStudentTab = document.getElementById('topNavStudentTab');
    const topNavStudioTab = document.getElementById('topNavStudioTab');
    if (topNavStudentTab) topNavStudentTab.classList.add('active');
    if (topNavStudioTab) topNavStudioTab.classList.remove('active');

    // Display student exercise screen
    const studentDash = document.getElementById('studentDashboardScreen');
    const explanationStage = document.getElementById('explanationStageContent');
    const exerciseStage = document.getElementById('exerciseStageContent');

    if (studentDash) studentDash.classList.add('hidden');
    if (explanationStage) explanationStage.classList.add('hidden');
    if (exerciseStage) exerciseStage.classList.remove('hidden');

    studentWrongExerciseIds = [];
    exerciseAnswerState = {};
    exerciseReviewState = {};
    renderCurrentExercise();
    showToast(`🧪 بدء اختبار التمارين التفاعلية (سؤال ${currentExerciseIndex + 1} من ${exercisesList.length})`);
}

let studentWrongExerciseIds = [];

// Trigger Sequential Reinforcement Stage (Explanation Slide -> Practice Exercise)
function triggerStudentReinforcementStage() {
    if (!currentLesson) {
        showStudentDashboard();
        return;
    }

    // Filter Targeted Explanation Slides & Exercises
    const reinfSlides = (currentLesson.reinforcement_slides || []).filter(s =>
        s.linked_exercise_id === 'all' || studentWrongExerciseIds.includes(s.linked_exercise_id)
    );

    const reinfExercises = (currentLesson.reinforcement_exercises || []).filter(ex =>
        ex.linked_exercise_id === 'all' || studentWrongExerciseIds.includes(ex.linked_exercise_id)
    );

    if (studentWrongExerciseIds.length === 0) {
        showToast('🏆 مبروك! أتقنت جميع تمارين الدرس بنجاح 100%، لا تحتاج تقوية!');
        showStudentDashboard();
        return;
    }

    if (reinfSlides.length > 0) {
        // Phase 1: Show Reinforcement Explanation Slide First
        slides = reinfSlides;
        currentIndex = 0;
        document.getElementById('presentationView').classList.add('active');
        document.getElementById('studioView').classList.remove('active');
        document.getElementById('studentDashboardScreen').classList.add('hidden');
        document.getElementById('exerciseStageContent').classList.add('hidden');
        document.getElementById('explanationStageContent').classList.remove('hidden');
        renderCurrentSlide();
        showToast('⚡ مرحلة التقوية: شرح تصحيح القاعدة النحوية أولاً 📚');
    } else if (reinfExercises.length > 0) {
        // Phase 2: Show Reinforcement Practice Exercise Directly
        runExerciseSimulator({ exercises: reinfExercises, title_ar: "تمرين تقوية المفاهيم ⚡" }, 0);
        showToast('⚡ مرحلة التقوية: سؤال تمرين التطبيق لتثبيت الفهم ✏️');
    } else {
        showStudentDashboard();
    }
}

// Transition to Practice Exercise Stage
function showExerciseStage() {
    document.getElementById('explanationStageContent').classList.add('hidden');
    document.getElementById('exerciseStageContent').classList.remove('hidden');
    currentExerciseIndex = 0;
    studentWrongExerciseIds = [];
    exerciseAnswerState = {};
    exerciseReviewState = {};
    renderCurrentExercise();
}

// Render one question at a time in a Google Forms-style flow.
function renderCurrentExercise() {
    if (!currentLesson) return;

    const exercisesList = (currentLesson.exercises && currentLesson.exercises.length > 0) 
        ? currentLesson.exercises 
        : (currentLesson.exercise ? [currentLesson.exercise] : []);

    if (exercisesList.length === 0) {
        showToast('لا توجد تمارين مضافة بعد!');
        showStudentDashboard();
        return;
    }

    if (currentExerciseIndex < 0 || currentExerciseIndex >= exercisesList.length) {
        currentExerciseIndex = 0;
    }

    const ex = exercisesList[currentExerciseIndex];
    currentExercise = ex;
    const exerciseKey = String(ex.id || `index-${currentExerciseIndex}`);
    const savedAnswer = exerciseAnswerState[exerciseKey];
    const isReviewed = exerciseReviewState[exerciseKey] === true;

    document.getElementById('exerciseLessonTitle').textContent = currentLesson.title_ar || "تمرين الدرس التفاعلي";
    document.getElementById('exerciseQuestionCounter').textContent = `سؤال ${currentExerciseIndex + 1} من ${exercisesList.length}`;

    const formTitle = document.getElementById('exerciseFormTitle');
    const formDescription = document.getElementById('exerciseFormDescription');
    const formQuestionLabel = document.getElementById('exerciseFormQuestionLabel');
    if (formTitle) formTitle.textContent = currentLesson.title_ar || 'اختبار الدرس';
    if (formDescription) formDescription.textContent = `أجب عن الأسئلة بالتسلسل (${exercisesList.length} أسئلة)، ثم انتقل للسؤال التالي.`;
    if (formQuestionLabel) formQuestionLabel.textContent = `السؤال ${currentExerciseIndex + 1}`;

    // Fill progress bar percentage
    const fillPercent = ((currentExerciseIndex + 1) / exercisesList.length) * 100;
    const progressFill = document.getElementById('exerciseProgressFill');
    if (progressFill) progressFill.style.width = `${fillPercent}%`;

    document.getElementById('exerciseInstructionBadge').textContent = ex.instruction_badge || "اختر الكلمة المناسبة لإكمال الجملة";
    document.getElementById('exerciseSentenceAr').textContent = ex.sentence_ar || "البنت تقرأ قصة في المكتبة.";
    
    const imgEl = document.getElementById('exerciseImg');
    if (imgEl) imgEl.src = ex.image || "/static/images/girl_reading_library.jpg";

    const questionEnEl = document.getElementById('exerciseQuestionEn');
    const parts = (ex.question_en || '').split('___');
    questionEnEl.innerHTML = '';
    parts.forEach((part, partIndex) => {
        questionEnEl.appendChild(document.createTextNode(part));
        if (partIndex < parts.length - 1) {
            const blank = document.createElement('span');
            blank.className = 'blank-space-line';
            blank.textContent = '___';
            questionEnEl.appendChild(blank);
        }
    });

    // Hide feedback cards initially
    const explanationBox = document.getElementById('exerciseStudentExplanation');
    const wrongFeedbackCard = document.getElementById('exerciseWrongFeedbackCard');
    const stage2ResultCard = document.getElementById('exerciseStage2ResultCard');

    if (explanationBox) explanationBox.classList.add('hidden');
    if (wrongFeedbackCard) wrongFeedbackCard.classList.add('hidden');
    if (stage2ResultCard) stage2ResultCard.classList.add('hidden');

    const optionsGrid = document.getElementById('exerciseOptionsGrid');
    optionsGrid.innerHTML = '';

    const opts = ex.options || ["writes", "reads", "eats"];
    const correctIdx = ex.correct_index !== undefined ? ex.correct_index : 1;

    opts.forEach((optText, idx) => {
        const btn = document.createElement('button');
        btn.className = 'btn-exercise-opt';
        btn.type = 'button';
        btn.setAttribute('role', 'radio');
        btn.setAttribute('aria-checked', String(savedAnswer === idx));
        btn.textContent = optText;
        if (savedAnswer === idx) btn.classList.add('selected');
        if (isReviewed) {
            btn.disabled = true;
            if (idx === correctIdx) btn.classList.add('correct');
            if (idx === savedAnswer && idx !== correctIdx) btn.classList.add('wrong');
        }

        btn.addEventListener('click', () => {
            if (exerciseReviewState[exerciseKey]) return;
            const buttons = optionsGrid.querySelectorAll('.btn-exercise-opt');
            buttons.forEach(b => {
                b.classList.remove('selected');
                b.setAttribute('aria-checked', 'false');
            });
            btn.classList.add('selected');
            btn.setAttribute('aria-checked', 'true');
            exerciseAnswerState[exerciseKey] = idx;

            const continueBtn = document.getElementById('btnExerciseContinue');
            if (continueBtn) continueBtn.disabled = false;
        });

        optionsGrid.appendChild(btn);
    });

    const previousBtn = document.getElementById('btnExercisePreviousQuestion');
    const continueBtn = document.getElementById('btnExerciseContinue');
    if (previousBtn) {
        previousBtn.disabled = currentExerciseIndex === 0;
        previousBtn.onclick = () => {
            if (currentExerciseIndex > 0) {
                currentExerciseIndex--;
                renderCurrentExercise();
            }
        };
    }
    if (continueBtn) {
        continueBtn.disabled = savedAnswer === undefined;
        continueBtn.innerHTML = isReviewed
            ? (currentExerciseIndex < exercisesList.length - 1 ? 'السؤال التالي <i class="fa-solid fa-arrow-left"></i>' : 'إنهاء التمرين <i class="fa-solid fa-check"></i>')
            : 'التالي <i class="fa-solid fa-arrow-left"></i>';
        continueBtn.onclick = () => {
            const selectedIdx = exerciseAnswerState[exerciseKey];
            if (selectedIdx === undefined) {
                showToast('اختر إجابة أولًا للانتقال للسؤال التالي.');
                return;
            }

            if (!exerciseReviewState[exerciseKey]) {
                exerciseReviewState[exerciseKey] = true;
                if (selectedIdx !== correctIdx && ex.id && !studentWrongExerciseIds.includes(ex.id)) {
                    studentWrongExerciseIds.push(ex.id);
                }
                showToast(selectedIdx === correctIdx ? '🎉 إجابة صحيحة مذهلة!' : 'راجع التوضيح ثم تابع للخطوة التالية.');
                renderCurrentExercise();
                return;
            }

            if (currentExerciseIndex < exercisesList.length - 1) {
                currentExerciseIndex++;
                renderCurrentExercise();
            } else {
                triggerStudentReinforcementStage();
            }
        };
    }

    if (isReviewed) {
        const selectedIdx = savedAnswer;
        const isCorrect = selectedIdx === correctIdx;
        const buttons = optionsGrid.querySelectorAll('.btn-exercise-opt');
        if (buttons[correctIdx]) buttons[correctIdx].classList.add('correct');
        if (!isCorrect && buttons[selectedIdx]) buttons[selectedIdx].classList.add('wrong');

        if (!isCorrect && wrongFeedbackCard) {
            const wrongText = document.getElementById('exerciseWrongFeedbackText');
            if (wrongText) wrongText.textContent = ex.wrong_note || ex.explanation || 'تذكر أن الفاعل المفرد He يحتاج الفعل مضافاً إليه s.';
            wrongFeedbackCard.classList.remove('hidden');
        }

        if (explanationBox && ex.explanation) {
            const explanationText = document.getElementById('exerciseStudentExplanationText');
            if (explanationText) explanationText.textContent = ex.explanation;
            explanationBox.classList.remove('hidden');
        }

        if (stage2ResultCard) {
            const rTitle = document.getElementById('exerciseStage2ResultTitle');
            const rBadge = document.getElementById('exerciseStage2RevealBadge');
            const rExp = document.getElementById('exerciseStage2RevealExplanation');
            if (rTitle) rTitle.textContent = ex.result_title || (isCorrect ? 'أحسنت! ظهرت القاعدة 🎁' : 'توضيح القاعدة النحوية 🎁');
            if (rBadge) rBadge.textContent = ex.reveal_badge || 'He + plays';
            if (rExp) rExp.textContent = ex.reveal_explanation || 'ممتاز! لاحظت أن He يحتاج الفعل مع s.';
            stage2ResultCard.classList.remove('hidden');
        }
    }
}

// Exercise Visual Block Builder Global Variables & State
let activeExTheme = 'coral';
let activeExBlocksOrder = ['ex_badge', 'ex_sentence_ar', 'ex_image', 'ex_question_en', 'ex_options', 'ex_wrong_note', 'ex_stage2_reveal', 'ex_explanation'];
let activeExHiddenBlocks = [];
let activeExPreviewStage = 1;

// Switch Stage inside Exercise Edit Modal Preview (3-Stage Preview Suite)
function switchExModalPreviewStage(stageNum) {
    activeExPreviewStage = stageNum;
    const btn1 = document.getElementById('btnExPreviewStage1');
    const btn2 = document.getElementById('btnExPreviewStage2');
    const btn3 = document.getElementById('btnExPreviewStage3');

    [btn1, btn2, btn3].forEach(b => {
        if (b) { b.style.background = 'transparent'; b.style.color = '#475569'; b.classList.remove('active'); }
    });

    if (stageNum === 1 && btn1) {
        btn1.style.background = '#FFFFFF'; btn1.style.color = '#0D9488'; btn1.classList.add('active');
    } else if (stageNum === 2 && btn2) {
        btn2.style.background = '#FFFFFF'; btn2.style.color = '#0D9488'; btn2.classList.add('active');
    } else if (stageNum === 3 && btn3) {
        btn3.style.background = '#FFFFFF'; btn3.style.color = '#DC2626'; btn3.classList.add('active');
    }
    updateExerciseLivePreview();
}

// Open Live Exercise Editor Modal with Visual Block Builder
function openExerciseEditModal() {
    if (!currentExercise && currentLesson) currentExercise = currentLesson.exercise;
    if (!currentExercise) return;

    activeExTheme = currentExercise.theme || 'coral';
    activeExBlocksOrder = currentExercise.blocks_order || ['ex_badge', 'ex_sentence_ar', 'ex_image', 'ex_question_en', 'ex_options', 'ex_wrong_note', 'ex_stage2_reveal', 'ex_explanation'];
    activeExHiddenBlocks = currentExercise.hidden_blocks || [];
    activeExPreviewStage = 1;

    document.getElementById('formExerciseId').value = currentExercise.id;
    
    // Set theme active palette
    const exPaletteBtns = document.querySelectorAll('.ex-palette-btn');
    exPaletteBtns.forEach(btn => {
        if (btn.dataset.theme === activeExTheme) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    applyExThemeToPreview(activeExTheme);

    switchExModalPreviewStage(1);
    renderExDynamicBlocks();
    updateExerciseLivePreview();

    const exerciseEditModal = document.getElementById('exerciseEditModal');
    if (exerciseEditModal) exerciseEditModal.classList.remove('hidden');
}

// Apply Theme Palette for Exercise Preview
function applyExThemeToPreview(themeName) {
    const liveExPhoneFrame = document.getElementById('liveExPhoneFrame');
    if (liveExPhoneFrame) liveExPhoneFrame.className = `full-mini-phone-frame theme-${themeName}`;
}

// Render Exercise Block Editor Cards in Form
function renderExDynamicBlocks() {
    const container = document.getElementById('dynamicExBlocksContainer');
    if (!container || !currentExercise) return;

    const ex = currentExercise;
    const badgeVal = ex.instruction_badge || 'اختر الكلمة المناسبة لإكمال الجملة';
    const sentenceArVal = ex.sentence_ar || 'البنت تقرأ قصة في المكتبة.';
    const questionEnVal = ex.question_en || 'She ___ a story in the library.';
    const opt0 = (ex.options && ex.options[0]) ? ex.options[0] : 'writes';
    const opt1 = (ex.options && ex.options[1]) ? ex.options[1] : 'reads';
    const opt2 = (ex.options && ex.options[2]) ? ex.options[2] : 'eats';
    const correctIdx = ex.correct_index !== undefined ? ex.correct_index : 1;
    const wrongNoteVal = ex.wrong_note || 'تذكر أن الفاعل المفرد He يحتاج الفعل مضافاً إليه s.';
    const resultTitleVal = ex.result_title || 'أحسنت! ظهرت القاعدة 🎁';
    const revealBadgeVal = ex.reveal_badge || 'He + plays';
    const revealExplanationVal = ex.reveal_explanation || 'ممتاز! لاحظت أن He يحتاج الفعل مع s.';
    const explanationVal = ex.explanation || '';
    const imageVal = ex.image || '/static/images/girl_reading_library.jpg';

    container.innerHTML = '';

    activeExBlocksOrder.forEach((blockId, index) => {
        const card = document.createElement('div');
        card.className = `block-editor-card ${activeExHiddenBlocks.includes(blockId) ? 'is-hidden-block' : ''}`;
        card.dataset.blockId = blockId;

        let blockTitle = '';
        let blockIcon = '';
        let blockFieldsHtml = '';

        if (blockId === 'ex_badge') {
            blockTitle = 'وسام التوجيه والتنبيه (Instruction Badge)';
            blockIcon = 'fa-solid fa-flag';
            blockFieldsHtml = `
                <div class="form-group">
                    <label>وسام التوجيه في أعلى التمرين</label>
                    <input type="text" id="formExBadge" value="${badgeVal}" placeholder="اختر الكلمة المناسبة لإكمال الجملة">
                </div>
            `;
        } else if (blockId === 'ex_sentence_ar') {
            blockTitle = 'الجملة المترجمة بالعربية (Arabic Translation Card)';
            blockIcon = 'fa-solid fa-language';
            blockFieldsHtml = `
                <div class="form-group">
                    <label>الجملة المترجمة بالعربية</label>
                    <input type="text" id="formExSentenceAr" value="${sentenceArVal}" placeholder="البنت تقرأ قصة في المكتبة.">
                </div>
            `;
        } else if (blockId === 'ex_image') {
            blockTitle = 'الصورة التوضيحية 3D والرفع من الكمبيوتر (Visual Image)';
            blockIcon = 'fa-solid fa-image';
            blockFieldsHtml = `
                <div class="form-group">
                    <label>الصورة التوضيحية 3D للتمرين</label>
                    <select id="formExImage" onchange="handleExImageSelectChange(this.value)">
                        <option value="/static/images/girl_reading_library.jpg" ${imageVal === '/static/images/girl_reading_library.jpg' ? 'selected' : ''}>📚 صورة قراءة القصة في المكتبة (girl_reading_library.jpg)</option>
                        <option value="/static/images/kids_football.jpg" ${imageVal === '/static/images/kids_football.jpg' ? 'selected' : ''}>⚽ صورة لعب الكرة (kids_football.jpg)</option>
                        <option value="/static/images/child_breakfast.jpg" ${imageVal === '/static/images/child_breakfast.jpg' ? 'selected' : ''}>🥞 صورة تناول الفطور (child_breakfast.jpg)</option>
                        <option value="/static/images/girl_school.jpg" ${imageVal === '/static/images/girl_school.jpg' ? 'selected' : ''}>👧 صورة الذهاب للمدرسة (girl_school.jpg)</option>
                        <option value="upload" ${imageVal.startsWith('/static/uploads/') ? 'selected' : ''}>📁 رفع صورة جديدة من جهاز الكمبيوتر...</option>
                        <option value="custom" ${(!imageVal.startsWith('/static/images/') && !imageVal.startsWith('/static/uploads/')) ? 'selected' : ''}>رابط صورة مخصص...</option>
                    </select>
                </div>

                <div id="exFileUploadGroup" class="form-group ${imageVal.startsWith('/static/uploads/') ? '' : 'hidden'}" style="background: #F0FDFA; border: 1.5px dashed var(--teal-primary); padding: 1rem; border-radius: 14px; text-align: center;">
                    <label for="formExFileUploadInput" style="color: var(--teal-primary); font-weight: 800; cursor: pointer; display: block;">
                        <i class="fa-solid fa-cloud-arrow-up" style="font-size: 1.6rem; margin-bottom: 0.3rem;"></i><br>
                        انقر هنا لااختيار صورة جديدة من جهازك
                    </label>
                    <input type="file" id="formExFileUploadInput" accept="image/*" style="display: none;" onchange="uploadExImageFromPC(this)">
                    <span id="exUploadStatusText" class="upload-status-hint" style="font-size: 0.8rem; color: var(--text-muted); font-weight: 700; margin-top: 0.3rem; display: block;">صيغ مدعومة: JPG, PNG, WEBP</span>
                </div>

                <div id="exCustomUrlGroup" class="form-group ${(!imageVal.startsWith('/static/images/')) ? '' : 'hidden'}">
                    <label>رابط الصورة المباشر (URL)</label>
                    <input type="url" id="formExCustomImageUrl" value="${imageVal}" placeholder="https://example.com/image.jpg">
                </div>
            `;
        } else if (blockId === 'ex_question_en') {
            blockTitle = 'الجملة الإنجليزية المنقوطة (Question EN with ___)';
            blockIcon = 'fa-solid fa-circle-question';
            blockFieldsHtml = `
                <div class="form-group">
                    <label>الجملة الإنجليزية مع الفراغ (استخدم ___ للفراغ)</label>
                    <input type="text" id="formExQuestionEn" class="en-font" value="${questionEnVal}" placeholder="She ___ a story in the library.">
                </div>
            `;
        } else if (blockId === 'ex_options') {
            blockTitle = 'خيارات الإجابة المتعددة والإجابة الصحيحة (Answer Options)';
            blockIcon = 'fa-solid fa-list-check';
            blockFieldsHtml = `
                <div class="form-row" style="display: flex; gap: 0.6rem; margin-bottom: 0.8rem;">
                    <div class="form-group" style="flex: 1;">
                        <label>الخيار الأول (Option 1)</label>
                        <input type="text" id="formExOpt0" class="en-font" value="${opt0}" placeholder="writes">
                    </div>
                    <div class="form-group" style="flex: 1;">
                        <label>الخيار الثاني (Option 2)</label>
                        <input type="text" id="formExOpt1" class="en-font" value="${opt1}" placeholder="reads">
                    </div>
                    <div class="form-group" style="flex: 1;">
                        <label>الخيار الثالث (Option 3)</label>
                        <input type="text" id="formExOpt2" class="en-font" value="${opt2}" placeholder="eats">
                    </div>
                </div>
                <div class="form-group">
                    <label>تحديد رقم الإجابة الصحيحة</label>
                    <select id="formExCorrect">
                        <option value="0" ${correctIdx === 0 ? 'selected' : ''}>الخيار الأول (Option 1)</option>
                        <option value="1" ${correctIdx === 1 ? 'selected' : ''}>الخيار الثاني (Option 2)</option>
                        <option value="2" ${correctIdx === 2 ? 'selected' : ''}>الخيار الثالث (Option 3)</option>
                    </select>
                </div>
            `;
        } else if (blockId === 'ex_wrong_note') {
            blockTitle = 'تنبيه وملاحظة الخطأ عند الحل الخاطئ (Wrong Note Alert)';
            blockIcon = 'fa-solid fa-triangle-exclamation';
            blockFieldsHtml = `
                <div class="form-group">
                    <label>رسالة التنبيه التي تظهر للطالب عند اختيار إجابة خاطئة</label>
                    <input type="text" id="formExWrongNote" value="${wrongNoteVal}" placeholder="تذكر أن الفاعل المفرد He يحتاج الفعل مضافاً إليه s.">
                </div>
            `;
        } else if (blockId === 'ex_stage2_reveal') {
            blockTitle = 'المرحلة الثانية: كرت كشف القاعدة والنتيجة 🎁 (Stage 2 Reveal Card)';
            blockIcon = 'fa-solid fa-gift';
            blockFieldsHtml = `
                <div class="form-row" style="display: flex; gap: 0.6rem; margin-bottom: 0.8rem;">
                    <div class="form-group" style="flex: 1;">
                        <label>عنوان كرت كشف القاعدة</label>
                        <input type="text" id="formExResultTitle" value="${resultTitleVal}" placeholder="أحسنت! ظهرت القاعدة 🎁">
                    </div>
                    <div class="form-group" style="flex: 1;">
                        <label>الرمز المضيء المكشوف (Pronoun Highlight)</label>
                        <input type="text" id="formExRevealBadge" class="en-font" value="${revealBadgeVal}" placeholder="He + plays">
                    </div>
                </div>
                <div class="form-group">
                    <label>توضيح وشرح كشف القاعدة</label>
                    <input type="text" id="formExRevealExplanation" value="${revealExplanationVal}" placeholder="ممتاز! لاحظت أن He يحتاج الفعل مع s.">
                </div>
            `;
        } else if (blockId === 'ex_explanation') {
            blockTitle = 'توضيح وتفسير الإجابة عند الحل (Explanation Note)';
            blockIcon = 'fa-solid fa-lightbulb';
            blockFieldsHtml = `
                <div class="form-group">
                    <label>توضيح الإجابة الصحيحة للطلاب</label>
                    <input type="text" id="formExExplanation" value="${explanationVal}" placeholder="reads هي الإجابة الصحيحة لأن الجملة تعني...">
                </div>
            `;
        }

        card.innerHTML = `
            <div class="block-header-bar">
                <div class="block-title-tag">
                    <i class="${blockIcon}"></i>
                    <span>${blockTitle}</span>
                </div>
                <div class="block-controls">
                    <button type="button" class="btn-block-action btn-move-up" title="تحريك للأعلى" onclick="moveExBlock(${index}, -1)" ${index === 0 ? 'disabled' : ''}>⬆️</button>
                    <button type="button" class="btn-block-action btn-move-down" title="تحريك للأسفل" onclick="moveExBlock(${index}, 1)" ${index === activeExBlocksOrder.length - 1 ? 'disabled' : ''}>⬇️</button>
                    <button type="button" class="btn-block-action btn-toggle-vis" title="إخفاء/إظهار" onclick="toggleExBlockVisibility('${blockId}')">${activeExHiddenBlocks.includes(blockId) ? '🙈' : '👁️'}</button>
                    <button type="button" class="btn-block-action delete-btn btn-delete-block" title="حذف العنصر" onclick="removeExBlock('${blockId}')"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
            <div class="block-card-body ${activeExHiddenBlocks.includes(blockId) ? 'hidden' : ''}">
                ${blockFieldsHtml}
            </div>
        `;

        container.appendChild(card);
    });

    // Attach Live Input Listeners
    const inputs = container.querySelectorAll('input, select, textarea');
    inputs.forEach(inp => {
        inp.addEventListener('input', updateExerciseLivePreview);
        inp.addEventListener('change', updateExerciseLivePreview);
    });
}

// Move Block Up/Down
function moveExBlock(index, direction) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= activeExBlocksOrder.length) return;
    const temp = activeExBlocksOrder[index];
    activeExBlocksOrder[index] = activeExBlocksOrder[targetIndex];
    activeExBlocksOrder[targetIndex] = temp;
    renderExDynamicBlocks();
    updateExerciseLivePreview();
}

// Toggle Block Visibility
function toggleExBlockVisibility(blockId) {
    if (activeExHiddenBlocks.includes(blockId)) {
        activeExHiddenBlocks = activeExHiddenBlocks.filter(b => b !== blockId);
    } else {
        activeExHiddenBlocks.push(blockId);
    }
    renderExDynamicBlocks();
    updateExerciseLivePreview();
}

// Remove Block
function removeExBlock(blockId) {
    if (activeExBlocksOrder.length <= 1) {
        showToast('يجب الاحتفاظ بمكون واحد على الأقل في التمرين!');
        return;
    }
    activeExBlocksOrder = activeExBlocksOrder.filter(b => b !== blockId);
    renderExDynamicBlocks();
    updateExerciseLivePreview();
}

// Handle Exercise Image Select Change
function handleExImageSelectChange(val) {
    const customGroup = document.getElementById('exCustomUrlGroup');
    const uploadGroup = document.getElementById('exFileUploadGroup');
    if (val === 'custom') {
        if (customGroup) customGroup.classList.remove('hidden');
        if (uploadGroup) uploadGroup.classList.add('hidden');
    } else if (val === 'upload') {
        if (uploadGroup) uploadGroup.classList.remove('hidden');
        if (customGroup) customGroup.classList.remove('hidden');
    } else {
        if (customGroup) customGroup.classList.add('hidden');
        if (uploadGroup) uploadGroup.classList.add('hidden');
    }
    updateExerciseLivePreview();
}

// Upload Exercise Image from Computer
async function uploadExImageFromPC(inputEl) {
    const file = inputEl.files[0];
    if (!file) return;
    const statusText = document.getElementById('exUploadStatusText');
    if (statusText) statusText.textContent = "⏳ جاري رفع الصورة إلى السيرفر...";

    const formData = new FormData();
    formData.append('image_file', file);

    try {
        const res = await fetch('/api/upload_image', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.success) {
            const customUrlInput = document.getElementById('formExCustomImageUrl');
            if (customUrlInput) customUrlInput.value = data.image_url;
            if (statusText) statusText.textContent = `✓ تم رفع الصورة بنجاح! (${file.name})`;
            updateExerciseLivePreview();
            showToast('🎉 تم رفع صورة التمرين من جهازك بنجاح!');
        }
    } catch (err) {
        if (statusText) statusText.textContent = "❌ فشل رفع الصورة";
        showToast('تعذر رفع صورة التمرين');
    }
}

// Update Live Exercise Smartphone Preview (Two-Stage Modal Live Preview)
function updateExerciseLivePreview() {
    const container = document.getElementById('liveExPreviewContent');
    if (!container) return;

    const getVal = (id) => {
        const el = document.getElementById(id);
        return el ? el.value.trim() : '';
    };

    let imgVal = getVal('formExImage');
    if (imgVal === 'custom' || imgVal === 'upload') imgVal = getVal('formExCustomImageUrl');

    const badgeVal = getVal('formExBadge') || 'اختر الكلمة المناسبة لإكمال الجملة';
    const sentenceArVal = getVal('formExSentenceAr') || 'البنت تقرأ قصة في المكتبة.';
    const questionEnVal = getVal('formExQuestionEn') || 'She ___ a story in the library.';
    const opt0 = getVal('formExOpt0') || 'writes';
    const opt1 = getVal('formExOpt1') || 'reads';
    const opt2 = getVal('formExOpt2') || 'eats';
    const correctIdx = parseInt(getVal('formExCorrect')) || 0;
    const wrongNoteVal = getVal('formExWrongNote') || 'تذكر أن الفاعل المفرد He يحتاج الفعل مضافاً إليه s.';
    const resultTitleVal = getVal('formExResultTitle') || 'أحسنت! ظهرت القاعدة 🎁';
    const revealBadgeVal = getVal('formExRevealBadge') || 'He + plays';
    const revealExplanationVal = getVal('formExRevealExplanation') || 'ممتاز! لاحظت أن He يحتاج الفعل مع s.';
    const explanationVal = getVal('formExExplanation') || '';

    container.innerHTML = '';

    activeExBlocksOrder.forEach(blockId => {
        if (activeExHiddenBlocks.includes(blockId)) return;

        const blockWrapper = document.createElement('div');
        blockWrapper.className = 'preview-block-item';
        blockWrapper.dataset.blockId = blockId;

        if (activeExPreviewStage === 1) {
            // STAGE 1: QUESTION & GUESSING STAGE
            if (blockId === 'ex_badge') {
                blockWrapper.innerHTML = `<div class="exercise-instruction-badge" data-field-target="formExBadge" style="cursor:pointer;">${badgeVal}</div>`;
            } else if (blockId === 'ex_sentence_ar') {
                blockWrapper.innerHTML = `<div class="exercise-sentence-translation-box" data-field-target="formExSentenceAr" style="cursor:pointer;">${sentenceArVal}</div>`;
            } else if (blockId === 'ex_image' && imgVal) {
                blockWrapper.innerHTML = `<div class="exercise-image-frame" data-field-target="formExImage" style="cursor:pointer;"><img src="${imgVal}" alt="صورة التمرين" class="exercise-img"></div>`;
            } else if (blockId === 'ex_question_en') {
                const parts = questionEnVal.split('___');
                const qContent = parts.length === 2 ? `${parts[0]}<span class="blank-space-line">___</span>${parts[1]}` : questionEnVal;
                blockWrapper.innerHTML = `<div class="exercise-question-sentence" data-field-target="formExQuestionEn" style="cursor:pointer;">${qContent}</div>`;
            } else if (blockId === 'ex_options') {
                blockWrapper.innerHTML = `
                    <div class="exercise-options-grid-3">
                        <button class="btn-exercise-opt" type="button" data-field-target="formExOpt0" style="cursor:pointer;">${opt0}</button>
                        <button class="btn-exercise-opt" type="button" data-field-target="formExOpt1" style="cursor:pointer;">${opt1}</button>
                        <button class="btn-exercise-opt" type="button" data-field-target="formExOpt2" style="cursor:pointer;">${opt2}</button>
                    </div>
                `;
            }
        } else if (activeExPreviewStage === 2) {
            // STAGE 2: CORRECT ANSWER & RULE REVEAL 🎁
            if (blockId === 'ex_badge') {
                blockWrapper.innerHTML = `<div class="exercise-instruction-badge" data-field-target="formExBadge" style="cursor:pointer;">${badgeVal}</div>`;
            } else if (blockId === 'ex_sentence_ar') {
                blockWrapper.innerHTML = `<div class="exercise-sentence-translation-box" data-field-target="formExSentenceAr" style="cursor:pointer;">${sentenceArVal}</div>`;
            } else if (blockId === 'ex_question_en') {
                const parts = questionEnVal.split('___');
                const qContent = parts.length === 2 ? `${parts[0]}<span class="blank-space-line">___</span>${parts[1]}` : questionEnVal;
                blockWrapper.innerHTML = `<div class="exercise-question-sentence" data-field-target="formExQuestionEn" style="cursor:pointer;">${qContent}</div>`;
            } else if (blockId === 'ex_options') {
                blockWrapper.innerHTML = `
                    <div class="exercise-options-grid-3">
                        <button class="btn-exercise-opt ${correctIdx === 0 ? 'correct' : ''}" type="button" data-field-target="formExOpt0" style="cursor:pointer;">${opt0}</button>
                        <button class="btn-exercise-opt ${correctIdx === 1 ? 'correct' : ''}" type="button" data-field-target="formExOpt1" style="cursor:pointer;">${opt1}</button>
                        <button class="btn-exercise-opt ${correctIdx === 2 ? 'correct' : ''}" type="button" data-field-target="formExOpt2" style="cursor:pointer;">${opt2}</button>
                    </div>
                `;
            } else if (blockId === 'ex_stage2_reveal') {
                blockWrapper.innerHTML = `
                    <div class="discovery-result-card" data-field-target="formExResultTitle" style="text-align: center; background: linear-gradient(135deg, #F0FDFA 0%, #CCFBF1 100%); border: 2px solid #5EEAD4; padding: 1.1rem; border-radius: 18px; cursor:pointer;">
                        <div class="discovery-result-header" style="font-size: 0.95rem; font-weight: 900; color: #0F766E;">${resultTitleVal}</div>
                        <div class="discovery-reveal-pronoun" data-field-target="formExRevealBadge" style="font-size: 2rem; color: #0D9488; font-weight: 900; margin: 0.3rem 0;">${revealBadgeVal}</div>
                        <div class="discovery-reveal-explanation" data-field-target="formExRevealExplanation" style="font-size: 0.85rem; color: #115E59; font-weight: 700;">${revealExplanationVal}</div>
                    </div>
                `;
            } else if (blockId === 'ex_explanation' && explanationVal) {
                blockWrapper.innerHTML = `<div class="exercise-explanation-box" data-field-target="formExExplanation" style="background: #ECFDF5; border: 1.5px solid #6EE7B7; color: #065F46; padding: 0.8rem; border-radius: 12px; font-size: 0.85rem; font-weight: 700; cursor: pointer;"><i class="fa-solid fa-lightbulb" style="color: #10B981;"></i> ${explanationVal}</div>`;
            }
        } else if (activeExPreviewStage === 3) {
            // STAGE 3: WRONG ANSWER & CORRECTION ALERT ⚠️
            const wrongOptionIdx = (correctIdx === 0) ? 1 : 0;
            if (blockId === 'ex_badge') {
                blockWrapper.innerHTML = `<div class="exercise-instruction-badge" data-field-target="formExBadge" style="cursor:pointer;">${badgeVal}</div>`;
            } else if (blockId === 'ex_sentence_ar') {
                blockWrapper.innerHTML = `<div class="exercise-sentence-translation-box" data-field-target="formExSentenceAr" style="cursor:pointer;">${sentenceArVal}</div>`;
            } else if (blockId === 'ex_question_en') {
                const parts = questionEnVal.split('___');
                const qContent = parts.length === 2 ? `${parts[0]}<span class="blank-space-line">___</span>${parts[1]}` : questionEnVal;
                blockWrapper.innerHTML = `<div class="exercise-question-sentence" data-field-target="formExQuestionEn" style="cursor:pointer;">${qContent}</div>`;
            } else if (blockId === 'ex_options') {
                blockWrapper.innerHTML = `
                    <div class="exercise-options-grid-3">
                        <button class="btn-exercise-opt ${wrongOptionIdx === 0 ? 'wrong' : (correctIdx === 0 ? 'correct' : '')}" type="button" data-field-target="formExOpt0" style="cursor:pointer;">${opt0}</button>
                        <button class="btn-exercise-opt ${wrongOptionIdx === 1 ? 'wrong' : (correctIdx === 1 ? 'correct' : '')}" type="button" data-field-target="formExOpt1" style="cursor:pointer;">${opt1}</button>
                        <button class="btn-exercise-opt ${wrongOptionIdx === 2 ? 'wrong' : (correctIdx === 2 ? 'correct' : '')}" type="button" data-field-target="formExOpt2" style="cursor:pointer;">${opt2}</button>
                    </div>
                `;
            } else if (blockId === 'ex_wrong_note' && wrongNoteVal) {
                blockWrapper.innerHTML = `
                    <div class="two-stage-wrong-alert" data-field-target="formExWrongNote" style="background: #FEF2F2; border: 1.5px solid #FCA5A5; color: #991B1B; padding: 0.7rem 0.9rem; border-radius: 12px; font-size: 0.82rem; font-weight: 700; display: flex; align-items: center; gap: 0.5rem; cursor:pointer;">
                        <i class="fa-solid fa-triangle-exclamation" style="color: #DC2626;"></i>
                        <span>${wrongNoteVal}</span>
                    </div>
                `;
            } else if (blockId === 'ex_stage2_reveal') {
                blockWrapper.innerHTML = `
                    <div class="discovery-result-card" data-field-target="formExResultTitle" style="text-align: center; background: linear-gradient(135deg, #F0FDFA 0%, #CCFBF1 100%); border: 2px solid #5EEAD4; padding: 1.1rem; border-radius: 18px; cursor:pointer;">
                        <div class="discovery-result-header" style="font-size: 0.95rem; font-weight: 900; color: #0F766E;">توضيح القاعدة 🎁</div>
                        <div class="discovery-reveal-pronoun" data-field-target="formExRevealBadge" style="font-size: 2rem; color: #0D9488; font-weight: 900; margin: 0.3rem 0;">${revealBadgeVal}</div>
                        <div class="discovery-reveal-explanation" data-field-target="formExRevealExplanation" style="font-size: 0.85rem; color: #115E59; font-weight: 700;">${revealExplanationVal}</div>
                    </div>
                `;
            }
        }

        container.appendChild(blockWrapper);
    });

    // Granular Element-Level Hover & Click Mapping for Exercise Form Inputs
    const fieldTargets = container.querySelectorAll('[data-field-target]');
    fieldTargets.forEach(targetEl => {
        const targetInputId = targetEl.dataset.fieldTarget;
        const targetInput = document.getElementById(targetInputId);
        const formGroup = targetInput ? targetInput.closest('.form-group') : null;

        targetEl.addEventListener('mouseenter', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.form-group.field-hover-highlight').forEach(fg => fg.classList.remove('field-hover-highlight'));
            if (formGroup) {
                formGroup.classList.add('field-hover-highlight');
                formGroup.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });

        targetEl.addEventListener('mouseleave', (e) => {
            e.stopPropagation();
            if (formGroup) formGroup.classList.remove('field-hover-highlight');
        });

        targetEl.addEventListener('click', (e) => {
            if (targetInput) {
                targetInput.focus();
                if (formGroup) {
                    formGroup.classList.add('field-hover-highlight');
                    setTimeout(() => formGroup.classList.remove('field-hover-highlight'), 2500);
                }
            }
        });
    });

    // Highlight Editor Block Card on Hovering Block Item
    const previewItems = container.querySelectorAll('.preview-block-item');
    previewItems.forEach(pItem => {
        const blockId = pItem.dataset.blockId;

        pItem.addEventListener('mouseenter', () => {
            const editorCard = document.querySelector(`.block-editor-card[data-block-id="${blockId}"]`);
            if (editorCard) editorCard.classList.add('block-highlighted');
        });

        pItem.addEventListener('mouseleave', () => {
            const editorCard = document.querySelector(`.block-editor-card[data-block-id="${blockId}"]`);
            if (editorCard) editorCard.classList.remove('block-highlighted');
        });
    });
}

// Toast Utility
function showToast(msg) {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toastMsg');
    if (!toast || !toastMsg) return;
    toastMsg.textContent = msg;
    toast.classList.remove('hidden');
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 2500);
}

// Guided Self-Discovery Interactive Helpers (Matching Screenshots 1 & 2)
function triggerDiscoveryReveal(slideId, optionIdx) {
    const qStage = document.getElementById(`discoveryQuestionStage_${slideId}`);
    const rStage = document.getElementById(`discoveryResultStage_${slideId}`);
    if (qStage && rStage) {
        qStage.classList.add('hidden');
        rStage.classList.remove('hidden');
        showToast('🎉 أحسنت! اكتشفت قاعدة الضمير بنجاح');
    }
}

function resetDiscoveryStage(slideId) {
    const qStage = document.getElementById(`discoveryQuestionStage_${slideId}`);
    const rStage = document.getElementById(`discoveryResultStage_${slideId}`);
    if (qStage && rStage) {
        rStage.classList.add('hidden');
        qStage.classList.remove('hidden');
    }
}

// ==========================================
// 🌟 CUSTOM TEMPLATES MANAGEMENT SYSTEM (حفظ وتوليد القوالب المخصصة للمعلم)
// ==========================================

async function loadAndRenderCustomTemplates() {
    try {
        const res = await fetch('/api/custom_templates');
        const data = await res.json();
        if (!data.success) return;

        const customTemplates = data.custom_templates || [];

        // 1. Render Custom Slide Templates in #addSlideTemplateModal
        const slidePickerGrid = document.querySelector('#addSlideTemplateModal .template-picker-cards-grid');
        if (slidePickerGrid) {
            const existingCustomHeader = slidePickerGrid.querySelector('.custom-templates-header-section');
            if (existingCustomHeader) existingCustomHeader.remove();
            slidePickerGrid.querySelectorAll('.custom-slide-template-card').forEach(c => c.remove());

            const slideTemplates = customTemplates.filter(t => t.category === 'slide');
            if (slideTemplates.length > 0) {
                const headerDiv = document.createElement('div');
                headerDiv.className = 'custom-templates-header-section';
                headerDiv.style.cssText = 'grid-column: 1 / -1; margin: 1.5rem 0 0.5rem 0; border-top: 2px dashed #CBD5E1; padding-top: 1rem; display: flex; align-items: center; justify-content: space-between;';
                headerDiv.innerHTML = `
                    <h3 style="margin: 0; font-weight: 900; color: #D97706; font-size: 1.2rem; display: flex; align-items: center; gap: 0.5rem;">
                        <i class="fa-solid fa-star" style="color: #F59E0B;"></i> ⭐ القوالب المخصصة المحفوظة بواسطة المعلم (${slideTemplates.length})
                    </h3>
                `;
                slidePickerGrid.appendChild(headerDiv);

                slideTemplates.forEach(tpl => {
                    const tCard = document.createElement('div');
                    tCard.className = 'picker-card-option custom-slide-template-card';
                    tCard.style.cssText = 'border: 2px solid #FCD34D; background: #FFFBEB; position: relative;';
                    tCard.innerHTML = `
                        <button type="button" class="btn-delete-custom-tpl" data-tpl-id="${tpl.id}" title="حذف القالب" style="position: absolute; top: 10px; left: 10px; border: none; background: #FEE2E2; color: #EF4444; border-radius: 50%; width: 28px; height: 28px; font-weight: 800; cursor: pointer; display: flex; align-items: center; justify-content: center; z-index: 10;">&times;</button>
                        <div class="card-option-header">
                            <div class="picker-icon-box" style="background: #FEF3C7; color: #D97706; font-size: 1.3rem;">⭐</div>
                            <div>
                                <h4 style="color: #92400E;">${tpl.name}</h4>
                                <p style="color: #B45309;">قالب مخصص تم حفظه حديثاً</p>
                            </div>
                        </div>
                        <div class="picker-phone-frame" style="padding: 1rem; text-align: center; background: #FFF; border-radius: 14px; margin: 0.8rem 0; border: 1px dashed #FBBF24;">
                            <div style="font-weight: 800; color: #78350F; font-size: 0.95rem;">${tpl.data.title_ar || tpl.name}</div>
                            <div style="font-size: 0.82rem; color: #92400E; margin-top: 0.3rem;">${stripHtml(tpl.data.description_ar || 'مكونات مخصصة جاهزة للإدراج مباشرة')}</div>
                        </div>
                        <button type="button" class="btn-select-custom-slide-tpl" style="width: 100%; background: linear-gradient(135deg, #F59E0B 0%, #D97706 100%); color: #FFF; border: none; padding: 0.7rem; border-radius: 12px; font-weight: 800; cursor: pointer; font-family: inherit;">
                            <i class="fa-solid fa-plus-circle"></i> استخدام هذا القالب المخصص
                        </button>
                    `;

                    tCard.querySelector('.btn-delete-custom-tpl').onclick = async (e) => {
                        e.stopPropagation();
                        if (!confirm(`هل أنت تأكد من رغبتك في حذف القالب المخصص (${tpl.name})؟`)) return;
                        await fetch(`/api/custom_templates/${tpl.id}`, { method: 'DELETE' });
                        loadAndRenderCustomTemplates();
                        showToast('تم حذف القالب المخصص بنجاح');
                    };

                    tCard.querySelector('.btn-select-custom-slide-tpl').onclick = async (e) => {
                        e.stopPropagation();
                        const addSlideTemplateModal = document.getElementById('addSlideTemplateModal');
                        if (addSlideTemplateModal) addSlideTemplateModal.classList.add('hidden');

                        const slideData = JSON.parse(JSON.stringify(tpl.data));
                        slideData.lesson_id = currentLesson ? currentLesson.id : 101;
                        
                        try {
                            const addRes = await fetch('/api/slides', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(slideData)
                            });
                            const addData = await addRes.json();
                            if (addData.success) {
                                curriculumData = addData.curriculum;
                                if (currentUnit) currentUnit = curriculumData.units.find(u => u.id === currentUnit.id) || curriculumData.units[0];
                                if (currentLesson && currentUnit) currentLesson = currentUnit.lessons.find(l => l.id === currentLesson.id) || currentUnit.lessons[0];
                                renderStudioLessonsList();
                                showToast(`⭐ تم إنشاء الشريحة بنجاح من القالب المخصص: ${tpl.name}`);
                            }
                        } catch (err) {
                            showToast('تعذر إضافة الشريحة من القالب المخصص');
                        }
                    };

                    slidePickerGrid.appendChild(tCard);
                });
            }
        }

        // 2. Render Custom Exercise Templates in #addExerciseTemplateModal
        const exPickerGrid = document.querySelector('#addExerciseTemplateModal .template-picker-cards-grid');
        if (exPickerGrid) {
            const existingCustomHeader = exPickerGrid.querySelector('.custom-ex-header-section');
            if (existingCustomHeader) existingCustomHeader.remove();
            exPickerGrid.querySelectorAll('.custom-ex-template-card').forEach(c => c.remove());

            const exTemplates = customTemplates.filter(t => t.category === 'exercise');
            if (exTemplates.length > 0) {
                const headerDiv = document.createElement('div');
                headerDiv.className = 'custom-ex-header-section';
                headerDiv.style.cssText = 'grid-column: 1 / -1; margin: 1.5rem 0 0.5rem 0; border-top: 2px dashed #CBD5E1; padding-top: 1rem; display: flex; align-items: center; justify-content: space-between;';
                headerDiv.innerHTML = `
                    <h3 style="margin: 0; font-weight: 900; color: #D97706; font-size: 1.2rem; display: flex; align-items: center; gap: 0.5rem;">
                        <i class="fa-solid fa-star" style="color: #F59E0B;"></i> ⭐ قوالب التمارين المخصصة المحفوظة (${exTemplates.length})
                    </h3>
                `;
                exPickerGrid.appendChild(headerDiv);

                exTemplates.forEach(tpl => {
                    const tCard = document.createElement('div');
                    tCard.className = 'picker-exercise-option custom-ex-template-card';
                    tCard.style.cssText = 'border: 2px solid #FCD34D; background: #FFFBEB; border-radius: 16px; padding: 1.2rem; position: relative;';
                    tCard.innerHTML = `
                        <button type="button" class="btn-delete-custom-tpl" data-tpl-id="${tpl.id}" title="حذف القالب" style="position: absolute; top: 10px; left: 10px; border: none; background: #FEE2E2; color: #EF4444; border-radius: 50%; width: 28px; height: 28px; font-weight: 800; cursor: pointer; display: flex; align-items: center; justify-content: center; z-index: 10;">&times;</button>
                        <div class="picker-icon-box" style="width: 48px; height: 48px; border-radius: 12px; background: #FEF3C7; color: #D97706; display: flex; align-items: center; justify-content: center; font-size: 1.4rem; margin-bottom: 0.8rem;">
                            🎯
                        </div>
                        <h4 style="font-weight: 800; color: #92400E; margin-bottom: 0.4rem;">${tpl.name}</h4>
                        <p style="font-size: 0.85rem; color: #B45309;">${tpl.data.question_en || 'تمرين مخصص مجهز مسبقاً'}</p>
                        <button type="button" class="btn-select-custom-ex-tpl" style="margin-top: 1rem; width: 100%; background: linear-gradient(135deg, #F59E0B 0%, #D97706 100%); color: #FFF; border: none; padding: 0.6rem; border-radius: 10px; font-weight: 700; cursor: pointer; font-family: inherit;">➕ أضف هذا القالب المخصص</button>
                    `;

                    tCard.querySelector('.btn-delete-custom-tpl').onclick = async (e) => {
                        e.stopPropagation();
                        if (!confirm(`هل أنت تأكد من حذف قالب التمرين المخصص (${tpl.name})؟`)) return;
                        await fetch(`/api/custom_templates/${tpl.id}`, { method: 'DELETE' });
                        loadAndRenderCustomTemplates();
                        showToast('تم حذف قالب التمرين المخصص');
                    };

                    tCard.querySelector('.btn-select-custom-ex-tpl').onclick = async (e) => {
                        e.stopPropagation();
                        const addExerciseTemplateModal = document.getElementById('addExerciseTemplateModal');
                        if (addExerciseTemplateModal) addExerciseTemplateModal.classList.add('hidden');

                        const exData = JSON.parse(JSON.stringify(tpl.data));
                        exData.lesson_id = currentLesson ? currentLesson.id : 101;

                        try {
                            const addRes = await fetch('/api/exercises', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(exData)
                            });
                            const addData = await addRes.json();
                            if (addData.success) {
                                curriculumData = addData.curriculum;
                                renderStudioLessonsList();
                                showToast(`⭐ تم إنشاء التمرين من القالب المخصص: ${tpl.name}`);
                            }
                        } catch (err) {
                            showToast('تعذر إضافة التمرين من القالب المخصص');
                        }
                    };

                    exPickerGrid.appendChild(tCard);
                });
            }
        }
    } catch (err) {}
}

// Wire Event Listeners for Save as Custom Template Buttons
document.addEventListener('DOMContentLoaded', () => {
    loadAndRenderCustomTemplates();

    const btnSaveCustomSlideTemplate = document.getElementById('btnSaveCustomSlideTemplate');
    if (btnSaveCustomSlideTemplate) {
        btnSaveCustomSlideTemplate.addEventListener('click', async () => {
            const defaultName = (currentSlide && currentSlide.title_ar) ? currentSlide.title_ar : 'قالب شرح مخصص';
            const tplName = prompt('ادخل اسماً مميزاً للقالب المخصص الجديد:', defaultName);
            if (!tplName || !tplName.trim()) return;

            const getVal = (id) => {
                const el = document.getElementById(id);
                return el ? el.value.trim() : '';
            };

            const slideDataToSave = {
                template_type: document.getElementById('formTemplateTypeVal')?.value || (currentSlide ? currentSlide.template_type : 'two_stage'),
                welcome_badge: getVal('formWelcomeBadge') || (currentSlide ? currentSlide.welcome_badge : ''),
                title_ar: getVal('formTitleAr') || (currentSlide ? currentSlide.title_ar : 'قالب شرح مخصص'),
                title_en: getVal('formTitleEn') || (currentSlide ? currentSlide.title_en : ''),
                description_ar: getVal('formDescriptionAr') || (currentSlide ? currentSlide.description_ar : ''),
                description_en: getVal('formDescriptionEn') || (currentSlide ? currentSlide.description_en : ''),
                rule_title: getVal('formRuleTitle') || (currentSlide ? currentSlide.rule_title : ''),
                rule_desc: getVal('formRuleDesc') || (currentSlide ? currentSlide.rule_desc : ''),
                example_en: getVal('formExampleEn') || (currentSlide ? currentSlide.example_en : ''),
                example_ar: getVal('formExampleAr') || (currentSlide ? currentSlide.example_ar : ''),
                image: getVal('formCustomImageUrl') || getVal('formImageSelect') || (currentSlide ? currentSlide.image : '/static/images/girl_school.jpg'),
                teacher_notes: getVal('formTeacherNotes') || (currentSlide ? currentSlide.teacher_notes : ''),
                scene_badge: getVal('formTwoStageSceneBadge') || getVal('formDiscSceneBadge') || (currentSlide ? currentSlide.scene_badge : 'المشهد 1 من 4'),
                question_ar: getVal('formTwoStageQuestion') || getVal('formDiscQuestion') || (currentSlide ? currentSlide.question_ar : 'اختر الجملة الصحيحة للصورة.'),
                hint_note: getVal('formTwoStageHintNote') || (currentSlide ? currentSlide.hint_note : ''),
                wrong_note: getVal('formTwoStageWrongNote') || (currentSlide ? currentSlide.wrong_note : ''),
                options: [
                    getVal('formTwoStageOpt0') || getVal('formDiscOpt0') || (currentSlide && currentSlide.options ? currentSlide.options[0] : 'He plays football.'),
                    getVal('formTwoStageOpt1') || getVal('formDiscOpt1') || (currentSlide && currentSlide.options ? currentSlide.options[1] : 'He play football.'),
                    getVal('formTwoStageOpt2') || getVal('formDiscOpt2') || (currentSlide && currentSlide.options ? currentSlide.options[2] : 'He playing football.')
                ],
                correct_index: currentSlide ? (currentSlide.correct_index || 0) : 0,
                result_title: getVal('formTwoStageResultTitle') || getVal('formDiscResultTitle') || (currentSlide ? currentSlide.result_title : 'أحسنت! ظهرت القاعدة'),
                reveal_badge: getVal('formTwoStageRevealBadge') || getVal('formDiscRevealBadge') || (currentSlide ? currentSlide.reveal_badge : 'He + plays'),
                reveal_explanation: getVal('formTwoStageRevealExplanation') || getVal('formDiscRevealExplanation') || (currentSlide ? currentSlide.reveal_explanation : 'ممتاز! لاحظت أن He يحتاج الفعل مع s.'),
                reveal_note: getVal('formDiscRevealNote') || (currentSlide ? currentSlide.reveal_note : ''),
                blocks_order: activeBlocksOrder || (currentSlide ? currentSlide.blocks_order : ['two_stage_block'])
            };

            try {
                const res = await fetch('/api/custom_templates', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: tplName.trim(),
                        category: 'slide',
                        icon: '⭐',
                        data: slideDataToSave
                    })
                });
                const data = await res.json();
                if (data.success) {
                    showToast('⭐ تم حفظ الشريحة كقالب مخصص بنجاح في داتابيز المعلم!');
                    loadAndRenderCustomTemplates();
                }
            } catch (err) {
                showToast('تعذر حفظ القالب المخصص');
            }
        });
    }

    const btnSaveCustomExerciseTemplate = document.getElementById('btnSaveCustomExerciseTemplate');
    if (btnSaveCustomExerciseTemplate) {
        btnSaveCustomExerciseTemplate.addEventListener('click', async () => {
            if (!currentExercise) {
                showToast('الرجاء فتح تمرين أولاً لحفظه كقالب!');
                return;
            }
            const tplName = prompt('ادخل اسماً مميزاً للقالب المخصص للتمرين:', currentExercise.instruction_badge || 'قالب تمرين مخصص');
            if (!tplName || !tplName.trim()) return;

            const exDataToSave = {
                question_type: currentExercise.question_type || 'multiple_choice',
                instruction_badge: document.getElementById('exFormInstructionBadge')?.value || currentExercise.instruction_badge || '',
                sentence_ar: document.getElementById('exFormSentenceAr')?.value || currentExercise.sentence_ar || '',
                question_en: document.getElementById('exFormQuestionEn')?.value || currentExercise.question_en || '',
                options: [
                    document.getElementById('exFormOpt0')?.value || '',
                    document.getElementById('exFormOpt1')?.value || '',
                    document.getElementById('exFormOpt2')?.value || ''
                ],
                correct_index: parseInt(document.getElementById('exFormCorrectIndex')?.value || 0),
                explanation: document.getElementById('exFormExplanation')?.value || currentExercise.explanation || '',
                image: document.getElementById('exFormImageSelect')?.value || currentExercise.image || '/static/images/kids_football.jpg'
            };

            try {
                const res = await fetch('/api/custom_templates', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: tplName.trim(),
                        category: 'exercise',
                        icon: '🎯',
                        data: exDataToSave
                    })
                });
                const data = await res.json();
                if (data.success) {
                    showToast('⭐ تم حفظ التمرين كقالب مخصص بنجاح في داتابيز المعلم!');
                    loadAndRenderCustomTemplates();
                }
            } catch (err) {
                showToast('تعذر حفظ قالب التمرين المخصص');
            }
        });
    }
});
