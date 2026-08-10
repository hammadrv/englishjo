from flask import Flask, render_template, jsonify, request, session, redirect, url_for
from functools import wraps
import json
import os
import time
import sqlite3

app = Flask(__name__)
app.secret_key = 'present_simple_super_secret_admin_key_2026'

ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "Rami$123"

SLIDES_FILE = os.path.join(os.path.dirname(__file__), 'slides.json')
DB_FILE = os.path.join(os.path.dirname(__file__), 'database.db')
UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'static', 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('logged_in'):
            if request.path.startswith('/api/'):
                return jsonify({"success": False, "message": "يلزم تسجيل الدخول أولاً"}), 401
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

def get_db_connection():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    c = conn.cursor()

    # Units Table
    c.execute('''
        CREATE TABLE IF NOT EXISTS units (
            id INTEGER PRIMARY KEY,
            title_ar TEXT NOT NULL,
            title_en TEXT,
            badge TEXT,
            sort_order INTEGER DEFAULT 0
        )
    ''')

    # Lessons Table
    c.execute('''
        CREATE TABLE IF NOT EXISTS lessons (
            id INTEGER PRIMARY KEY,
            unit_id INTEGER NOT NULL,
            badge TEXT,
            title_ar TEXT NOT NULL,
            title_en TEXT,
            subtitle TEXT,
            reinforcement_type TEXT DEFAULT 'slides',
            sort_order INTEGER DEFAULT 0,
            FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE
        )
    ''')

    # Slides Table
    c.execute('''
        CREATE TABLE IF NOT EXISTS slides (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lesson_id INTEGER NOT NULL,
            template_type TEXT,
            welcome_badge TEXT,
            title_ar TEXT,
            title_en TEXT,
            description_ar TEXT,
            description_en TEXT,
            rule_title TEXT,
            rule_desc TEXT,
            example_en TEXT,
            example_ar TEXT,
            image TEXT,
            teacher_notes TEXT,
            scene_badge TEXT,
            question_ar TEXT,
            hint_note TEXT,
            wrong_note TEXT,
            options_json TEXT,
            correct_index INTEGER DEFAULT 0,
            result_title TEXT,
            reveal_badge TEXT,
            reveal_explanation TEXT,
            reveal_note TEXT,
            blocks_order_json TEXT,
            linked_exercise_id TEXT DEFAULT 'all',
            is_reinforcement INTEGER DEFAULT 0,
            sort_order INTEGER DEFAULT 0,
            FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE
        )
    ''')

    # Exercises Table (Handles Practice, Reinforcement & Final Exam)
    c.execute('''
        CREATE TABLE IF NOT EXISTS exercises (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lesson_id INTEGER NOT NULL,
            question_type TEXT DEFAULT 'multiple_choice',
            instruction_badge TEXT,
            sentence_ar TEXT,
            question_en TEXT,
            options_json TEXT,
            correct_index INTEGER DEFAULT 0,
            explanation TEXT,
            wrong_note TEXT,
            result_title TEXT,
            reveal_badge TEXT,
            reveal_explanation TEXT,
            image TEXT,
            linked_exercise_id TEXT DEFAULT 'all',
            is_reinforcement INTEGER DEFAULT 0,
            is_exam INTEGER DEFAULT 0,
            sort_order INTEGER DEFAULT 0,
            FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE
        )
    ''')

    # Custom Templates Table (Saved Templates created by Teachers)
    c.execute('''
        CREATE TABLE IF NOT EXISTS custom_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            icon TEXT DEFAULT '⭐',
            data_json TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    conn.commit()

    # Automatic One-Time Migration from slides.json if DB is empty
    c.execute('SELECT COUNT(*) FROM units')
    count = c.fetchone()[0]
    if count == 0 and os.path.exists(SLIDES_FILE):
        print("📦 Migration: Importing initial curriculum from slides.json into SQLite Database...")
        try:
            with open(SLIDES_FILE, 'r', encoding='utf-8') as f:
                slides_data = json.load(f)

            for u_idx, u in enumerate(slides_data.get("units", [])):
                u_id = u.get("id", u_idx + 1)
                c.execute('INSERT INTO units (id, title_ar, title_en, badge, sort_order) VALUES (?, ?, ?, ?, ?)',
                          (u_id, u.get("title_ar", ""), u.get("title_en", ""), u.get("badge", ""), u_idx))

                for l_idx, l in enumerate(u.get("lessons", [])):
                    l_id = l.get("id", 100 + l_idx + 1)
                    c.execute('INSERT INTO lessons (id, unit_id, badge, title_ar, title_en, subtitle, reinforcement_type, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                              (l_id, u_id, l.get("badge", ""), l.get("title_ar", ""), l.get("title_en", ""), l.get("subtitle", ""), l.get("reinforcement_type", "slides"), l_idx))

                    # Insert Normal Slides
                    for s_idx, s in enumerate(l.get("slides", [])):
                        c.execute('''
                            INSERT INTO slides (id, lesson_id, template_type, welcome_badge, title_ar, title_en,
                            description_ar, description_en, rule_title, rule_desc, example_en, example_ar, image,
                            teacher_notes, scene_badge, question_ar, hint_note, wrong_note, options_json, correct_index,
                            result_title, reveal_badge, reveal_explanation, reveal_note, blocks_order_json, linked_exercise_id, is_reinforcement, sort_order)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
                        ''', (
                            s.get("id"), l_id, s.get("template_type", ""), s.get("welcome_badge", ""), s.get("title_ar", ""), s.get("title_en", ""),
                            s.get("description_ar", ""), s.get("description_en", ""), s.get("rule_title", ""), s.get("rule_desc", ""), s.get("example_en", ""), s.get("example_ar", ""), s.get("image", ""),
                            s.get("teacher_notes", ""), s.get("scene_badge", ""), s.get("question_ar", ""), s.get("hint_note", ""), s.get("wrong_note", ""), json.dumps(s.get("options", []), ensure_ascii=False), s.get("correct_index", 0),
                            s.get("result_title", ""), s.get("reveal_badge", ""), s.get("reveal_explanation", ""), s.get("reveal_note", ""), json.dumps(s.get("blocks_order", []), ensure_ascii=False), str(s.get("linked_exercise_id", "all")), s_idx
                        ))

                    # Insert Reinforcement Slides
                    for s_idx, s in enumerate(l.get("reinforcement_slides", [])):
                        c.execute('''
                            INSERT INTO slides (id, lesson_id, template_type, welcome_badge, title_ar, title_en,
                            description_ar, description_en, rule_title, rule_desc, example_en, example_ar, image,
                            teacher_notes, scene_badge, question_ar, hint_note, wrong_note, options_json, correct_index,
                            result_title, reveal_badge, reveal_explanation, reveal_note, blocks_order_json, linked_exercise_id, is_reinforcement, sort_order)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
                        ''', (
                            s.get("id"), l_id, s.get("template_type", ""), s.get("welcome_badge", ""), s.get("title_ar", ""), s.get("title_en", ""),
                            s.get("description_ar", ""), s.get("description_en", ""), s.get("rule_title", ""), s.get("rule_desc", ""), s.get("example_en", ""), s.get("example_ar", ""), s.get("image", ""),
                            s.get("teacher_notes", ""), s.get("scene_badge", ""), s.get("question_ar", ""), s.get("hint_note", ""), s.get("wrong_note", ""), json.dumps(s.get("options", []), ensure_ascii=False), s.get("correct_index", 0),
                            s.get("result_title", ""), s.get("reveal_badge", ""), s.get("reveal_explanation", ""), s.get("reveal_note", ""), json.dumps(s.get("blocks_order", []), ensure_ascii=False), str(s.get("linked_exercise_id", "all")), s_idx
                        ))

                    # Insert Exercises
                    ex_list = l.get("exercises", [])
                    if not ex_list and l.get("exercise"):
                        ex_list = [l["exercise"]]

                    for e_idx, ex in enumerate(ex_list):
                        c.execute('''
                            INSERT INTO exercises (id, lesson_id, question_type, instruction_badge, sentence_ar, question_en,
                            options_json, correct_index, explanation, wrong_note, result_title, reveal_badge, reveal_explanation, image, linked_exercise_id, is_reinforcement, is_exam, sort_order)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
                        ''', (
                            ex.get("id"), l_id, ex.get("question_type", "multiple_choice"), ex.get("instruction_badge", ""), ex.get("sentence_ar", ""), ex.get("question_en", ""),
                            json.dumps(ex.get("options", []), ensure_ascii=False), ex.get("correct_index", 0), ex.get("explanation", ""), ex.get("wrong_note", ""), ex.get("result_title", ""), ex.get("reveal_badge", ""), ex.get("reveal_explanation", ""), ex.get("image", ""), str(ex.get("linked_exercise_id", "all")), e_idx
                        ))

                    # Insert Reinforcement Exercises
                    for e_idx, ex in enumerate(l.get("reinforcement_exercises", [])):
                        c.execute('''
                            INSERT INTO exercises (id, lesson_id, question_type, instruction_badge, sentence_ar, question_en,
                            options_json, correct_index, explanation, wrong_note, result_title, reveal_badge, reveal_explanation, image, linked_exercise_id, is_reinforcement, is_exam, sort_order)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?)
                        ''', (
                            ex.get("id"), l_id, ex.get("question_type", "multiple_choice"), ex.get("instruction_badge", ""), ex.get("sentence_ar", ""), ex.get("question_en", ""),
                            json.dumps(ex.get("options", []), ensure_ascii=False), ex.get("correct_index", 0), ex.get("explanation", ""), ex.get("wrong_note", ""), ex.get("result_title", ""), ex.get("reveal_badge", ""), ex.get("reveal_explanation", ""), ex.get("image", ""), str(ex.get("linked_exercise_id", "all")), e_idx
                        ))

                    # Insert Exam Questions
                    for e_idx, ex in enumerate(l.get("exam_questions", [])):
                        c.execute('''
                            INSERT INTO exercises (id, lesson_id, question_type, instruction_badge, sentence_ar, question_en,
                            options_json, correct_index, explanation, wrong_note, result_title, reveal_badge, reveal_explanation, image, linked_exercise_id, is_reinforcement, is_exam, sort_order)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?)
                        ''', (
                            ex.get("id"), l_id, ex.get("question_type", "multiple_choice"), ex.get("instruction_badge", ""), ex.get("sentence_ar", ""), ex.get("question_en", ""),
                            json.dumps(ex.get("options", []), ensure_ascii=False), ex.get("correct_index", 0), ex.get("explanation", ""), ex.get("wrong_note", ""), ex.get("result_title", ""), ex.get("reveal_badge", ""), ex.get("reveal_explanation", ""), ex.get("image", ""), str(ex.get("linked_exercise_id", "all")), e_idx
                        ))

            conn.commit()
            print("✅ Database migration completed successfully!")
        except Exception as err:
            print("❌ Migration Error:", err)

    conn.close()

# Helper: Get Full Curriculum from DB
def get_curriculum_data_from_db():
    conn = get_db_connection()
    c = conn.cursor()

    c.execute('SELECT * FROM units ORDER BY sort_order ASC, id ASC')
    units_rows = c.fetchall()

    curriculum = {"units": []}

    for u_row in units_rows:
        unit = {
            "id": u_row["id"],
            "title_ar": u_row["title_ar"],
            "title_en": u_row["title_en"],
            "badge": u_row["badge"],
            "lessons": []
        }

        c.execute('SELECT * FROM lessons WHERE unit_id = ? ORDER BY sort_order ASC, id ASC', (u_row["id"],))
        lessons_rows = c.fetchall()

        for l_row in lessons_rows:
            lesson = {
                "id": l_row["id"],
                "badge": l_row["badge"],
                "title_ar": l_row["title_ar"],
                "title_en": l_row["title_en"],
                "subtitle": l_row["subtitle"],
                "reinforcement_type": l_row["reinforcement_type"] or "slides",
                "slides": [],
                "reinforcement_slides": [],
                "exercises": [],
                "reinforcement_exercises": [],
                "exam_questions": []
            }

            # Fetch slides
            c.execute('SELECT * FROM slides WHERE lesson_id = ? ORDER BY is_reinforcement ASC, sort_order ASC, id ASC', (l_row["id"],))
            slides_rows = c.fetchall()
            for s in slides_rows:
                s_dict = {
                    "id": s["id"],
                    "template_type": s["template_type"],
                    "welcome_badge": s["welcome_badge"],
                    "title_ar": s["title_ar"],
                    "title_en": s["title_en"],
                    "description_ar": s["description_ar"],
                    "description_en": s["description_en"],
                    "rule_title": s["rule_title"],
                    "rule_desc": s["rule_desc"],
                    "example_en": s["example_en"],
                    "example_ar": s["example_ar"],
                    "image": s["image"],
                    "teacher_notes": s["teacher_notes"],
                    "scene_badge": s["scene_badge"],
                    "question_ar": s["question_ar"],
                    "hint_note": s["hint_note"],
                    "wrong_note": s["wrong_note"],
                    "options": json.loads(s["options_json"] or "[]"),
                    "correct_index": s["correct_index"],
                    "result_title": s["result_title"],
                    "reveal_badge": s["reveal_badge"],
                    "reveal_explanation": s["reveal_explanation"],
                    "reveal_note": s["reveal_note"],
                    "blocks_order": json.loads(s["blocks_order_json"] or "[]"),
                    "linked_exercise_id": s["linked_exercise_id"] if s["linked_exercise_id"] == "all" else (int(s["linked_exercise_id"]) if s["linked_exercise_id"] and s["linked_exercise_id"].isdigit() else "all")
                }
                if s["is_reinforcement"] == 1:
                    lesson["reinforcement_slides"].append(s_dict)
                else:
                    lesson["slides"].append(s_dict)

            # Fetch exercises
            c.execute('SELECT * FROM exercises WHERE lesson_id = ? ORDER BY is_exam ASC, is_reinforcement ASC, sort_order ASC, id ASC', (l_row["id"],))
            ex_rows = c.fetchall()
            for ex in ex_rows:
                ex_dict = {
                    "id": ex["id"],
                    "question_type": ex["question_type"],
                    "instruction_badge": ex["instruction_badge"],
                    "sentence_ar": ex["sentence_ar"],
                    "question_en": ex["question_en"],
                    "options": json.loads(ex["options_json"] or "[]"),
                    "correct_index": ex["correct_index"],
                    "explanation": ex["explanation"],
                    "wrong_note": ex["wrong_note"],
                    "result_title": ex["result_title"],
                    "reveal_badge": ex["reveal_badge"],
                    "reveal_explanation": ex["reveal_explanation"],
                    "image": ex["image"],
                    "linked_exercise_id": ex["linked_exercise_id"] if ex["linked_exercise_id"] == "all" else (int(ex["linked_exercise_id"]) if ex["linked_exercise_id"] and ex["linked_exercise_id"].isdigit() else "all")
                }
                if ex["is_exam"] == 1:
                    lesson["exam_questions"].append(ex_dict)
                elif ex["is_reinforcement"] == 1:
                    lesson["reinforcement_exercises"].append(ex_dict)
                else:
                    lesson["exercises"].append(ex_dict)

            if lesson["exercises"]:
                lesson["exercise"] = lesson["exercises"][0]

            unit["lessons"].append(lesson)

        curriculum["units"].append(unit)

    conn.close()
    return curriculum

# Initialize database on startup
init_db()

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
@login_required
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
    data = get_curriculum_data_from_db()
    return jsonify({"success": True, "curriculum": data})

@app.route('/api/slides', methods=['GET'])
def get_slides():
    data = get_curriculum_data_from_db()
    flat_slides = []
    for u in data.get("units", []):
        for l in u.get("lessons", []):
            flat_slides.extend(l.get("slides", []))
    return jsonify({"success": True, "slides": flat_slides})

@app.route('/api/slides', methods=['POST'])
@login_required
def add_slide():
    payload = request.get_json() or {}
    lesson_id = payload.get('lesson_id', 101)

    conn = get_db_connection()
    c = conn.cursor()

    c.execute('''
        INSERT INTO slides (lesson_id, template_type, welcome_badge, title_ar, title_en, description_ar, description_en,
        rule_title, rule_desc, example_en, example_ar, image, teacher_notes, scene_badge, question_ar, hint_note, wrong_note,
        options_json, correct_index, result_title, reveal_badge, reveal_explanation, reveal_note, blocks_order_json, linked_exercise_id, is_reinforcement)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        lesson_id,
        payload.get("template_type", "two_stage"),
        payload.get("welcome_badge", ""),
        payload.get("title_ar", "شريحة جديدة"),
        payload.get("title_en", "New Slide"),
        payload.get("description_ar", ""),
        payload.get("description_en", ""),
        payload.get("rule_title", ""),
        payload.get("rule_desc", ""),
        payload.get("example_en", ""),
        payload.get("example_ar", ""),
        payload.get("image", "/static/images/girl_school.jpg"),
        payload.get("teacher_notes", ""),
        payload.get("scene_badge", ""),
        payload.get("question_ar", ""),
        payload.get("hint_note", ""),
        payload.get("wrong_note", ""),
        json.dumps(payload.get("options", []), ensure_ascii=False),
        payload.get("correct_index", 0),
        payload.get("result_title", ""),
        payload.get("reveal_badge", ""),
        payload.get("reveal_explanation", ""),
        payload.get("reveal_note", ""),
        json.dumps(payload.get("blocks_order", []), ensure_ascii=False),
        str(payload.get("linked_exercise_id", "all")),
        1 if payload.get("is_reinforcement") else 0
    ))
    new_id = c.lastrowid
    conn.commit()
    conn.close()

    updated_curriculum = get_curriculum_data_from_db()
    return jsonify({"success": True, "new_slide_id": new_id, "curriculum": updated_curriculum})

@app.route('/api/slides/<int:slide_id>', methods=['PUT'])
@login_required
def update_slide(slide_id):
    payload = request.get_json() or {}

    conn = get_db_connection()
    c = conn.cursor()

    fields = []
    params = []

    possible_fields = [
        "template_type", "welcome_badge", "title_ar", "title_en", "description_ar", "description_en",
        "rule_title", "rule_desc", "example_en", "example_ar", "image", "teacher_notes", "scene_badge",
        "question_ar", "hint_note", "wrong_note", "correct_index", "result_title", "reveal_badge",
        "reveal_explanation", "reveal_note", "linked_exercise_id", "is_reinforcement"
    ]

    for f in possible_fields:
        if f in payload:
            fields.append(f"{f} = ?")
            params.append(payload[f])

    if "options" in payload:
        fields.append("options_json = ?")
        params.append(json.dumps(payload["options"], ensure_ascii=False))

    if "blocks_order" in payload:
        fields.append("blocks_order_json = ?")
        params.append(json.dumps(payload["blocks_order"], ensure_ascii=False))

    if fields:
        params.append(slide_id)
        sql = f"UPDATE slides SET {', '.join(fields)} WHERE id = ?"
        c.execute(sql, params)
        conn.commit()

    conn.close()
    updated_curriculum = get_curriculum_data_from_db()
    return jsonify({"success": True, "curriculum": updated_curriculum})

@app.route('/api/slides/<int:slide_id>', methods=['DELETE'])
@login_required
def delete_slide(slide_id):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("DELETE FROM slides WHERE id = ?", (slide_id,))
    conn.commit()
    conn.close()

    updated_curriculum = get_curriculum_data_from_db()
    return jsonify({"success": True, "curriculum": updated_curriculum})

@app.route('/api/units/<int:unit_id>', methods=['PUT'])
@login_required
def update_unit(unit_id):
    payload = request.get_json() or {}
    conn = get_db_connection()
    c = conn.cursor()

    fields = []
    params = []
    for f in ["title_ar", "title_en", "badge"]:
        if f in payload:
            fields.append(f"{f} = ?")
            params.append(payload[f])

    if fields:
        params.append(unit_id)
        c.execute(f"UPDATE units SET {', '.join(fields)} WHERE id = ?", params)
        conn.commit()

    conn.close()
    return jsonify({"success": True, "curriculum": get_curriculum_data_from_db()})

@app.route('/api/lessons/<int:lesson_id>', methods=['PUT'])
@login_required
def update_lesson(lesson_id):
    payload = request.get_json() or {}
    conn = get_db_connection()
    c = conn.cursor()

    fields = []
    params = []
    for f in ["title_ar", "title_en", "badge", "subtitle", "reinforcement_type"]:
        if f in payload:
            fields.append(f"{f} = ?")
            params.append(payload[f])

    if fields:
        params.append(lesson_id)
        c.execute(f"UPDATE lessons SET {', '.join(fields)} WHERE id = ?", params)
        conn.commit()

    # Bulk update reinforcement slides or exercises if passed in payload
    if "reinforcement_slides" in payload:
        c.execute("DELETE FROM slides WHERE lesson_id = ? AND is_reinforcement = 1", (lesson_id,))
        for s_idx, s in enumerate(payload["reinforcement_slides"]):
            c.execute('''
                INSERT INTO slides (lesson_id, template_type, welcome_badge, title_ar, title_en, description_ar, description_en, image, linked_exercise_id, is_reinforcement, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
            ''', (
                lesson_id, s.get("template_type", "two_stage"), s.get("welcome_badge", ""), s.get("title_ar", ""), s.get("title_en", ""), s.get("description_ar", ""), s.get("description_en", ""), s.get("image", ""), str(s.get("linked_exercise_id", "all")), s_idx
            ))
        conn.commit()

    if "reinforcement_exercises" in payload:
        c.execute("DELETE FROM exercises WHERE lesson_id = ? AND is_reinforcement = 1", (lesson_id,))
        for e_idx, ex in enumerate(payload["reinforcement_exercises"]):
            c.execute('''
                INSERT INTO exercises (lesson_id, question_type, instruction_badge, sentence_ar, question_en, options_json, correct_index, explanation, wrong_note, result_title, reveal_badge, reveal_explanation, image, linked_exercise_id, is_reinforcement, is_exam, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?)
            ''', (
                lesson_id, ex.get("question_type", "multiple_choice"), ex.get("instruction_badge", ""), ex.get("sentence_ar", ""), ex.get("question_en", ""), json.dumps(ex.get("options", []), ensure_ascii=False), ex.get("correct_index", 0), ex.get("explanation", ""), ex.get("wrong_note", ""), ex.get("result_title", ""), ex.get("reveal_badge", ""), ex.get("reveal_explanation", ""), ex.get("image", ""), str(ex.get("linked_exercise_id", "all")), e_idx
            ))
        conn.commit()

    conn.close()
    return jsonify({"success": True, "curriculum": get_curriculum_data_from_db()})

@app.route('/api/lessons', methods=['POST'])
@login_required
def add_lesson():
    payload = request.get_json() or {}
    unit_id = payload.get("unit_id", 1)
    title_ar = payload.get("title_ar", "درس جديد")
    title_en = payload.get("title_en", "New Lesson")

    conn = get_db_connection()
    c = conn.cursor()

    c.execute('SELECT MAX(id) FROM lessons')
    max_id = c.fetchone()[0] or 100
    new_lesson_id = max_id + 1

    c.execute('''
        INSERT INTO lessons (id, unit_id, badge, title_ar, title_en, subtitle, reinforcement_type)
        VALUES (?, ?, ?, ?, ?, ?, 'slides')
    ''', (new_lesson_id, unit_id, f"الدرس {new_lesson_id - 100}", f"الدرس: {title_ar}", f"Lesson – {title_en}", "3 شرائح شرح + تمرين تفاعلي"))

    # Add default slide
    c.execute('''
        INSERT INTO slides (lesson_id, template_type, welcome_badge, title_ar, title_en, description_ar, image, blocks_order_json)
        VALUES (?, 'two_stage', 'اكتشف القاعدة بنفسك', ?, ?, 'شريحة شرح تفاعلية جديدة.', '/static/images/kids_football.jpg', '["two_stage_block"]')
    ''', (new_lesson_id, title_ar, title_en))

    # Add default exercise
    c.execute('''
        INSERT INTO exercises (lesson_id, instruction_badge, sentence_ar, question_en, options_json, correct_index, image)
        VALUES (?, 'اختبر معلوماتك', 'اختر الإجابة المناسبة.', 'She _____ to school.', '["goes", "go", "going"]', 0, '/static/images/girl_school.jpg')
    ''', (new_lesson_id,))

    conn.commit()
    conn.close()

    return jsonify({"success": True, "new_lesson_id": new_lesson_id, "curriculum": get_curriculum_data_from_db()})

@app.route('/api/exercises', methods=['POST'])
@login_required
def add_exercise():
    payload = request.get_json() or {}
    lesson_id = payload.get('lesson_id', 101)

    conn = get_db_connection()
    c = conn.cursor()

    c.execute('''
        INSERT INTO exercises (lesson_id, question_type, instruction_badge, sentence_ar, question_en, options_json, correct_index, explanation, image, linked_exercise_id, is_reinforcement, is_exam)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
    ''', (
        lesson_id,
        payload.get("question_type", "multiple_choice"),
        payload.get("instruction_badge", "اختر الإجابة الصحيحة"),
        payload.get("sentence_ar", "تمرين تفاعلي جديد للدرس"),
        payload.get("question_en", "He _____ to the park every weekend."),
        json.dumps(payload.get("options", ["goes", "go", "going"]), ensure_ascii=False),
        payload.get("correct_index", 0),
        payload.get("explanation", "نستخدم goes مع الضمير المفرد He."),
        payload.get("image", "/static/images/kids_football.jpg"),
        str(payload.get("linked_exercise_id", "all"))
    ))
    new_id = c.lastrowid
    conn.commit()
    conn.close()

    return jsonify({"success": True, "new_exercise_id": new_id, "curriculum": get_curriculum_data_from_db()})

@app.route('/api/exercises/<int:exercise_id>', methods=['PUT'])
@login_required
def update_exercise(exercise_id):
    payload = request.get_json() or {}
    conn = get_db_connection()
    c = conn.cursor()

    fields = []
    params = []
    possible_fields = [
        "question_type", "instruction_badge", "sentence_ar", "question_en",
        "correct_index", "explanation", "wrong_note", "result_title",
        "reveal_badge", "reveal_explanation", "image", "linked_exercise_id",
        "is_reinforcement", "is_exam"
    ]

    for f in possible_fields:
        if f in payload:
            fields.append(f"{f} = ?")
            params.append(payload[f])

    if "options" in payload:
        fields.append("options_json = ?")
        params.append(json.dumps(payload["options"], ensure_ascii=False))

    if fields:
        params.append(exercise_id)
        c.execute(f"UPDATE exercises SET {', '.join(fields)} WHERE id = ?", params)
        conn.commit()

    conn.close()
    return jsonify({"success": True, "curriculum": get_curriculum_data_from_db()})

@app.route('/api/exercises/<int:exercise_id>', methods=['DELETE'])
@login_required
def delete_exercise(exercise_id):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("DELETE FROM exercises WHERE id = ?", (exercise_id,))
    conn.commit()
    conn.close()

    return jsonify({"success": True, "curriculum": get_curriculum_data_from_db()})

@app.route('/api/exam_questions', methods=['POST'])
@login_required
def add_exam_question():
    payload = request.get_json() or {}
    lesson_id = payload.get('lesson_id', 101)

    conn = get_db_connection()
    c = conn.cursor()

    c.execute('''
        INSERT INTO exercises (lesson_id, question_type, instruction_badge, sentence_ar, question_en, options_json, correct_index, explanation, result_title, reveal_badge, reveal_explanation, image, is_reinforcement, is_exam)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)
    ''', (
        lesson_id,
        payload.get("question_type", "multiple_choice"),
        payload.get("instruction_badge", "📝 الاختبار النهائي لتقييم الإتقان 🎯"),
        payload.get("sentence_ar", "جملة اختبار جديدة"),
        payload.get("question_en", "She _____ English fluently."),
        json.dumps(payload.get("options", ["speaks", "speak", "speaking"]), ensure_ascii=False),
        payload.get("correct_index", 0),
        payload.get("explanation", "نضيف s للفعل مع الضمير المفرد She."),
        payload.get("result_title", "إجابة صحيحة مذهلة! 🎉"),
        payload.get("reveal_badge", "She + speaks"),
        payload.get("reveal_explanation", "ممتاز! أتقنت استخدام الضمير المفرد مع الفعل."),
        payload.get("image", "/static/images/girl_reading_library.jpg")
    ))
    new_id = c.lastrowid
    conn.commit()
    conn.close()

    return jsonify({"success": True, "new_exam_question_id": new_id, "curriculum": get_curriculum_data_from_db()})

@app.route('/api/exam_questions/<int:question_id>', methods=['PUT'])
@login_required
def update_exam_question(question_id):
    return update_exercise(question_id)

@app.route('/api/exam_questions/<int:question_id>', methods=['DELETE'])
@login_required
def delete_exam_question(question_id):
    return delete_exercise(question_id)

@app.route('/api/custom_templates', methods=['GET'])
def get_custom_templates():
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT * FROM custom_templates ORDER BY id DESC")
    rows = c.fetchall()

    templates_list = []
    for r in rows:
        templates_list.append({
            "id": r["id"],
            "name": r["name"],
            "category": r["category"],
            "icon": r["icon"] or "⭐",
            "data": json.loads(r["data_json"] or "{}"),
            "created_at": r["created_at"]
        })
    conn.close()
    return jsonify({"success": True, "custom_templates": templates_list})

@app.route('/api/custom_templates', methods=['POST'])
@login_required
def save_custom_template():
    payload = request.get_json() or {}
    name = payload.get("name", "قالب مخصص جديد").strip()
    category = payload.get("category", "slide") # 'slide' or 'exercise'
    icon = payload.get("icon", "⭐")
    template_data = payload.get("data", {})

    conn = get_db_connection()
    c = conn.cursor()
    c.execute('''
        INSERT INTO custom_templates (name, category, icon, data_json)
        VALUES (?, ?, ?, ?)
    ''', (name, category, icon, json.dumps(template_data, ensure_ascii=False)))
    new_id = c.lastrowid
    conn.commit()
    conn.close()

    return jsonify({"success": True, "new_template_id": new_id, "message": "تم حفظ القالب المخصص بنجاح!"})

@app.route('/api/custom_templates/<int:template_id>', methods=['DELETE'])
@login_required
def delete_custom_template(template_id):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("DELETE FROM custom_templates WHERE id = ?", (template_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": "تم حذف القالب المخصص بنجاح"})

if __name__ == '__main__':
    print("=" * 60)
    print("🎓 تم تشغيل منصة شريحة Present Simple التفاعلية (مع قاعدة بيانات SQLite الدائمة) بنجاح!")
    print("📌 العنوان المحلي (Local):    http://127.0.0.1:5050")
    print("📌 العنوان على الشبكة (IP):    http://192.168.68.63:5050")
    print("🔌 المنفذ المستخدم (Port):    5050")
    print("💾 قاعدة البيانات المستخدمة:   database.db")
    print("=" * 60)
    app.run(host='0.0.0.0', port=5050, debug=False)
