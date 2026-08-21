from flask import Flask, render_template, jsonify, request, session, redirect, url_for
from functools import wraps
import json
import os
import time

app = Flask(__name__)
app.secret_key = 'present_simple_super_secret_admin_key_2026'

ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "Rami$123"

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('logged_in'):
            if request.path.startswith('/api/'):
                return jsonify({"success": False, "message": "يلزم تسجيل الدخول أولاً"}), 401
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

SLIDES_FILE = os.path.join(os.path.dirname(__file__), 'slides.json')
UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'static', 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

def load_curriculum_data():
    if not os.path.exists(SLIDES_FILE):
        return {"units": []}
    try:
        with open(SLIDES_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print("Error loading slides.json:", e)
        return {"units": []}

def save_curriculum_data(data):
    with open(SLIDES_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def get_flat_slides(data):
    slides_list = []
    for unit in data.get("units", []):
        for lesson in unit.get("lessons", []):
            slides_list.extend(lesson.get("slides", []))
    return slides_list

@app.route('/login', methods=['GET', 'POST'])
def login():
    if session.get('logged_in'):
        return redirect(url_for('index'))

    error = None
    username_val = ""

    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '').strip()
        username_val = username

        if username == ADMIN_USERNAME and password == ADMIN_PASSWORD:
            session['logged_in'] = True
            session['username'] = username
            return redirect(url_for('index'))
        else:
            error = "اسم المستخدم أو كلمة المرور غير صحيحة!"

    return render_template('login.html', error=error, username=username_val)

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))

@app.route('/')
@login_required
def index():
    return render_template('index.html')

@app.route('/api/upload_image', methods=['POST'])
def upload_image():
    if 'image_file' not in request.files:
        return jsonify({"success": False, "message": "لم يتم اختيار أي ملف"}), 400
    
    file = request.files['image_file']
    if file.filename == '':
        return jsonify({"success": False, "message": "اسم الملف فارغ"}), 400
    
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg']:
        ext = '.png'
    
    filename = f"img_{int(time.time() * 1000)}{ext}"
    filepath = os.path.join(UPLOAD_FOLDER, filename)
    file.save(filepath)
    
    image_url = f"/static/uploads/{filename}"
    return jsonify({"success": True, "image_url": image_url})

@app.route('/api/curriculum', methods=['GET'])
def get_curriculum():
    data = load_curriculum_data()
    return jsonify({"success": True, "curriculum": data})

@app.route('/api/slides', methods=['GET'])
def get_slides():
    data = load_curriculum_data()
    flat_slides = get_flat_slides(data)
    return jsonify({"success": True, "slides": flat_slides})

@app.route('/api/slides', methods=['POST'])
def add_slide():
    data = load_curriculum_data()
    payload = request.get_json() or {}
    lesson_id = payload.get('lesson_id', 101)
    
    new_slide_data = {k: v for k, v in payload.items() if k != 'lesson_id'}
    
    flat_slides = get_flat_slides(data)
    new_id = max([s['id'] for s in flat_slides], default=0) + 1
    new_slide_data['id'] = new_id

    lesson_found = False
    for unit in data.get("units", []):
        for lesson in unit.get("lessons", []):
            if lesson.get("id") == lesson_id:
                lesson.setdefault("slides", []).append(new_slide_data)
                lesson_found = True
                break
        if lesson_found:
            break
            
    if not lesson_found and data.get("units") and data["units"][0].get("lessons"):
        data["units"][0]["lessons"][0]["slides"].append(new_slide_data)

    save_curriculum_data(data)

    target_lesson_slides = []
    for unit in data.get("units", []):
        for lesson in unit.get("lessons", []):
            if lesson.get("id") == lesson_id:
                target_lesson_slides = lesson.get("slides", [])
                break

    return jsonify({"success": True, "slides": target_lesson_slides, "new_slide": new_slide_data, "curriculum": data})

@app.route('/api/slides/<int:slide_id>', methods=['PUT'])
def update_slide(slide_id):
    data = load_curriculum_data()
    updated_fields = request.get_json()

    slide_found = False
    for unit in data.get("units", []):
        for lesson in unit.get("lessons", []):
            for slide in lesson.get("slides", []):
                if slide["id"] == slide_id:
                    slide.update(updated_fields)
                    slide_found = True
                    break

    if slide_found:
        save_curriculum_data(data)
        return jsonify({"success": True, "slides": get_flat_slides(data)})
    return jsonify({"success": False, "message": "Slide not found"}), 404

@app.route('/api/slides/<int:slide_id>', methods=['DELETE'])
def delete_slide(slide_id):
    data = load_curriculum_data()
    
    slide_deleted = False
    for unit in data.get("units", []):
        for lesson in unit.get("lessons", []):
            slides_arr = lesson.get("slides", [])
            for idx, slide in enumerate(slides_arr):
                if slide["id"] == slide_id:
                    slides_arr.pop(idx)
                    slide_deleted = True
                    break

    if slide_deleted:
        save_curriculum_data(data)
        return jsonify({"success": True, "slides": get_flat_slides(data)})
    return jsonify({"success": False, "message": "Slide not found"}), 404

@app.route('/api/units/<int:unit_id>', methods=['PUT'])
def update_unit(unit_id):
    data = load_curriculum_data()
    payload = request.get_json() or {}
    
    found = False
    for unit in data.get("units", []):
        if unit.get("id") == unit_id:
            if "title_ar" in payload: unit["title_ar"] = payload["title_ar"]
            if "title_en" in payload: unit["title_en"] = payload["title_en"]
            if "badge" in payload: unit["badge"] = payload["badge"]
            found = True
            break
            
    if found:
        save_curriculum_data(data)
        return jsonify({"success": True, "curriculum": data})
    return jsonify({"success": False, "message": "Unit not found"}), 404

@app.route('/api/lessons/<int:lesson_id>', methods=['PUT'])
def update_lesson(lesson_id):
    data = load_curriculum_data()
    payload = request.get_json() or {}
    
    found = False
    for unit in data.get("units", []):
        for lesson in unit.get("lessons", []):
            if lesson.get("id") == lesson_id:
                if "title_ar" in payload: lesson["title_ar"] = payload["title_ar"]
                if "title_en" in payload: lesson["title_en"] = payload["title_en"]
                if "badge" in payload: lesson["badge"] = payload["badge"]
                found = True
                break
        if found:
            break
            
    if found:
        save_curriculum_data(data)
        return jsonify({"success": True, "curriculum": data})
    return jsonify({"success": False, "message": "Lesson not found"}), 404

@app.route('/api/lessons', methods=['POST'])
def add_lesson():
    data = load_curriculum_data()
    payload = request.get_json() or {}
    unit_id = payload.get("unit_id", 1)
    title_ar = payload.get("title_ar", "درس جديد")
    title_en = payload.get("title_en", "New Lesson")
    
    # Calculate next lesson id
    all_lessons = []
    for u in data.get("units", []):
        all_lessons.extend(u.get("lessons", []))
    new_lesson_id = max([l.get("id", 100) for l in all_lessons], default=100) + 1
    lesson_num = len(all_lessons) + 1
    
    new_lesson = {
        "id": new_lesson_id,
        "badge": f"الدرس {lesson_num}",
        "title_ar": f"الدرس {lesson_num}: {title_ar}",
        "title_en": f"Lesson {lesson_num} – {title_en}",
        "subtitle": "3 شرائح شرح + تمرين تفاعلي",
        "slides": [
            {
                "id": max([s['id'] for s in get_flat_slides(data)], default=0) + 1,
                "template_type": "two_stage",
                "welcome_badge": "اكتشف القاعدة بنفسك",
                "title_ar": f"الدرس {lesson_num}: {title_ar}",
                "title_en": f"Lesson {lesson_num}\nNew",
                "description_ar": "شريحة استكشافية تفاعلية جديدة للدرس.",
                "image": "/static/images/kids_football.jpg",
                "scene_badge": "المشهد 1 من 4",
                "question_ar": "اختر الجملة الصحيحة للصورة.",
                "hint_note": "لاحظ الفاعل ثم اختر الفعل المناسب.",
                "wrong_note": "تذكر اختيار الصيغة النحوية الصحيحة.",
                "options": ["He plays football.", "He play football.", "He playing football."],
                "correct_index": 0,
                "result_title": "أحسنت! ظهرت القاعدة",
                "reveal_badge": "He + plays",
                "reveal_explanation": "ممتاز! اكتشفت القاعدة الصحيحة.",
                "blocks_order": ["two_stage_block"]
            }
        ],
        "exercise": {
            "id": max([l.get("exercise", {}).get("id", 200) for l in all_lessons if l.get("exercise")], default=200) + 1,
            "instruction_badge": "اختبر معلوماتك في الدرس الجديد",
            "sentence_ar": "اختر الخيار المناسب للجملة.",
            "question_en": "She _____ to school every day.",
            "options": ["go", "goes", "going"],
            "correct_index": 1,
            "explanation": "نضيف es للفعل مع الضمير المفرد She.",
            "image": "/static/images/girl_school.jpg"
        }
    }
    
    unit_found = False
    for u in data.get("units", []):
        if u.get("id") == unit_id:
            u.setdefault("lessons", []).append(new_lesson)
            unit_found = True
            break
            
    if not unit_found and data.get("units"):
        data["units"][0].setdefault("lessons", []).append(new_lesson)
        
    save_curriculum_data(data)
    return jsonify({"success": True, "new_lesson": new_lesson, "curriculum": data})

@app.route('/api/exercises', methods=['POST'])
def add_exercise():
    data = load_curriculum_data()
    payload = request.get_json() or {}
    lesson_id = payload.get('lesson_id', 101)
    template_type = payload.get('template_type', 'multiple_choice')

    # Get max exercise id
    all_ex_ids = []
    for unit in data.get("units", []):
        for lesson in unit.get("lessons", []):
            ex_list = lesson.get("exercises", [])
            if not ex_list and lesson.get("exercise"):
                ex_list = [lesson["exercise"]]
            for ex in ex_list:
                if ex.get("id"): all_ex_ids.append(ex["id"])
    new_ex_id = max(all_ex_ids, default=0) + 1

    new_ex_data = {
        "id": new_ex_id,
        "question_type": template_type,
        "instruction_badge": payload.get("instruction_badge", "اختر الإجابة الصحيحة"),
        "sentence_ar": payload.get("sentence_ar", "تمرين تفاعلي جديد للدرس"),
        "question_en": payload.get("question_en", "He _____ to the park every weekend."),
        "options": payload.get("options", ["goes", "go", "going"]),
        "correct_index": payload.get("correct_index", 0),
        "explanation": payload.get("explanation", "نستخدم goes مع الضمير المفرد He في المضارع البسيط."),
        "image": payload.get("image", "/static/images/kids_football.jpg")
    }

    found = False
    for unit in data.get("units", []):
        for lesson in unit.get("lessons", []):
            if lesson.get("id") == lesson_id:
                if "exercises" not in lesson:
                    if "exercise" in lesson:
                        lesson["exercises"] = [lesson["exercise"]]
                    else:
                        lesson["exercises"] = []
                lesson["exercises"].append(new_ex_data)
                lesson["exercise"] = lesson["exercises"][0] # backward compatibility
                found = True
                break
        if found: break

    if found:
        save_curriculum_data(data)
        return jsonify({"success": True, "new_exercise": new_ex_data, "curriculum": data})
    return jsonify({"success": False, "message": "Lesson not found"}), 404

@app.route('/api/exercises/<int:exercise_id>', methods=['PUT'])
def update_exercise(exercise_id):
    data = load_curriculum_data()
    updated_fields = request.get_json()

    found = False
    for unit in data.get("units", []):
        for lesson in unit.get("lessons", []):
            ex_list = lesson.get("exercises", [])
            if not ex_list and lesson.get("exercise"):
                ex_list = [lesson["exercise"]]
                lesson["exercises"] = ex_list

            for ex in ex_list:
                if ex.get("id") == exercise_id:
                    ex.update(updated_fields)
                    found = True
                    break
            if found:
                lesson["exercise"] = ex_list[0]
                break
        if found: break

    if found:
        save_curriculum_data(data)
        return jsonify({"success": True, "curriculum": data})
    return jsonify({"success": False, "message": "Exercise not found"}), 404

@app.route('/api/exercises/<int:exercise_id>', methods=['DELETE'])
def delete_exercise(exercise_id):
    data = load_curriculum_data()

    found = False
    for unit in data.get("units", []):
        for lesson in unit.get("lessons", []):
            ex_list = lesson.get("exercises", [])
            if not ex_list and lesson.get("exercise"):
                ex_list = [lesson["exercise"]]
                lesson["exercises"] = ex_list

            for idx, ex in enumerate(ex_list):
                if ex.get("id") == exercise_id:
                    ex_list.pop(idx)
                    found = True
                    break
            if found:
                if ex_list:
                    lesson["exercise"] = ex_list[0]
                else:
                    lesson.pop("exercise", None)
                break
        if found: break

    if found:
        save_curriculum_data(data)
        return jsonify({"success": True, "curriculum": data})
    return jsonify({"success": False, "message": "Exercise not found"}), 404

@app.route('/api/exam_questions', methods=['POST'])
@login_required
def add_exam_question():
    data = load_curriculum_data()
    payload = request.get_json() or {}
    lesson_id = payload.get('lesson_id', 101)

    all_ids = []
    for unit in data.get("units", []):
        for lesson in unit.get("lessons", []):
            for eq in lesson.get("exam_questions", []):
                if eq.get("id"): all_ids.append(eq["id"])
    new_id = max(all_ids, default=950) + 1

    new_exam_q = {
        "id": new_id,
        "instruction_badge": payload.get("instruction_badge", "📝 الاختبار النهائي لتقييم الإتقان 🎯"),
        "sentence_ar": payload.get("sentence_ar", "جملة اختبار جديدة"),
        "question_en": payload.get("question_en", "She _____ English fluently."),
        "options": payload.get("options", ["speaks", "speak", "speaking"]),
        "correct_index": payload.get("correct_index", 0),
        "explanation": payload.get("explanation", "نضيف s للفعل مع الضمير المفرد She في حالة الإثبات."),
        "result_title": payload.get("result_title", "إجابة صحيحة مذهلة! 🎉"),
        "reveal_badge": payload.get("reveal_badge", "She + speaks"),
        "reveal_explanation": payload.get("reveal_explanation", "ممتاز! أتقنت استخدام الضمير المفرد مع الفعل."),
        "image": payload.get("image", "/static/images/girl_reading_library.jpg")
    }

    found = False
    for unit in data.get("units", []):
        for lesson in unit.get("lessons", []):
            if lesson.get("id") == lesson_id:
                lesson.setdefault("exam_questions", []).append(new_exam_q)
                found = True
                break
        if found: break

    if found:
        save_curriculum_data(data)
        return jsonify({"success": True, "new_exam_question": new_exam_q, "curriculum": data})
    return jsonify({"success": False, "message": "Lesson not found"}), 404

@app.route('/api/exam_questions/<int:question_id>', methods=['PUT'])
@login_required
def update_exam_question(question_id):
    data = load_curriculum_data()
    updated_fields = request.get_json() or {}

    found = False
    for unit in data.get("units", []):
        for lesson in unit.get("lessons", []):
            for eq in lesson.get("exam_questions", []):
                if eq.get("id") == question_id:
                    eq.update(updated_fields)
                    found = True
                    break
            if found: break
        if found: break

    if found:
        save_curriculum_data(data)
        return jsonify({"success": True, "curriculum": data})
    return jsonify({"success": False, "message": "Exam Question not found"}), 404

@app.route('/api/exam_questions/<int:question_id>', methods=['DELETE'])
@login_required
def delete_exam_question(question_id):
    data = load_curriculum_data()

    found = False
    for unit in data.get("units", []):
        for lesson in unit.get("lessons", []):
            eq_list = lesson.get("exam_questions", [])
            for idx, eq in enumerate(eq_list):
                if eq.get("id") == question_id:
                    eq_list.pop(idx)
                    found = True
                    break
            if found: break
        if found: break

    if found:
        save_curriculum_data(data)
        return jsonify({"success": True, "curriculum": data})
    return jsonify({"success": False, "message": "Exam Question not found"}), 404

if __name__ == '__main__':
    print("=" * 60)
    print("🎓 تم تشغيل منصة شريحة Present Simple التفاعلية بنجاح!")
    print("📌 العنوان المحالي (Local):    http://127.0.0.1:5050")
    print("📌 العنوان على الشبكة (IP):    http://37.187.205.15:5050")
    print("🔌 المنفذ المستخدم (Port):    5050")
    print("=" * 60)
    app.run(host='0.0.0.0', port=5050, debug=False)
