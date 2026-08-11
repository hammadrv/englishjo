from flask import Flask, render_template, jsonify, request, session, redirect, url_for
from functools import wraps
import hmac
import json
import os
import re
import secrets
import time
import sqlite3

app = Flask(__name__)
app.config.update(
    SECRET_KEY=os.environ.get('PRESENT_SIMPLE_SECRET_KEY'),
    MAX_CONTENT_LENGTH=10 * 1024 * 1024,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    SESSION_COOKIE_SECURE=os.environ.get('PRESENT_SIMPLE_COOKIE_SECURE', '').lower() in {'1', 'true', 'yes'},
)

if not app.config['SECRET_KEY']:
    raise RuntimeError('PRESENT_SIMPLE_SECRET_KEY must be configured before the app starts.')

ADMIN_USERNAME = os.environ.get('PRESENT_SIMPLE_ADMIN_USERNAME', 'admin')
ADMIN_PASSWORD = os.environ.get('PRESENT_SIMPLE_ADMIN_PASSWORD')
if not ADMIN_PASSWORD:
    raise RuntimeError('PRESENT_SIMPLE_ADMIN_PASSWORD must be configured before the app starts.')

SLIDES_FILE = os.path.join(os.path.dirname(__file__), 'slides.json')
DB_FILE = os.path.join(os.path.dirname(__file__), 'database.db')
UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'static', 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)


@app.after_request
def apply_security_headers(response):
    response.headers.setdefault('X-Content-Type-Options', 'nosniff')
    response.headers.setdefault('X-Frame-Options', 'SAMEORIGIN')
    response.headers.setdefault('Referrer-Policy', 'strict-origin-when-cross-origin')
    response.headers.setdefault('Permissions-Policy', 'camera=(), geolocation=(), payment=()')
    return response

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
        content_status TEXT NOT NULL DEFAULT 'published',
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

    # Learner profiles and evidence of learning are kept separately from content.
    c.execute('''
        CREATE TABLE IF NOT EXISTS students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            display_name TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS student_progress (
            student_id INTEGER NOT NULL,
            lesson_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'not_started',
            current_slide_index INTEGER NOT NULL DEFAULT 0,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP,
            PRIMARY KEY (student_id, lesson_id),
            FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
            FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS student_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL,
            lesson_id INTEGER NOT NULL,
            exercise_id INTEGER NOT NULL,
            selected_index INTEGER NOT NULL,
            is_correct INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
            FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE,
            FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE
        )
    ''')

    # A classroom is intentionally lightweight: students join with a teacher-created code.
    c.execute('''
        CREATE TABLE IF NOT EXISTS classrooms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            join_code TEXT NOT NULL UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS classroom_students (
            classroom_id INTEGER NOT NULL,
            student_id INTEGER NOT NULL,
            joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (classroom_id, student_id),
            FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE,
            FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS lesson_classrooms (
            lesson_id INTEGER NOT NULL,
            classroom_id INTEGER NOT NULL,
            PRIMARY KEY (lesson_id, classroom_id),
            FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE,
            FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE
        )
    ''')

    # Safe in-place migrations for databases created before these features existed.
    c.execute('PRAGMA table_info(lessons)')
    lesson_columns = {row['name'] for row in c.fetchall()}
    if 'content_status' not in lesson_columns:
        c.execute("ALTER TABLE lessons ADD COLUMN content_status TEXT NOT NULL DEFAULT 'published'")

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
def get_curriculum_data_from_db(include_drafts=True, student_id=None):
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

        lesson_query = 'SELECT * FROM lessons WHERE unit_id = ?'
        lesson_params = [u_row['id']]
        if not include_drafts:
            lesson_query += " AND content_status = 'published' AND (NOT EXISTS (SELECT 1 FROM lesson_classrooms WHERE lesson_classrooms.lesson_id = lessons.id) OR EXISTS (SELECT 1 FROM lesson_classrooms JOIN classroom_students ON classroom_students.classroom_id = lesson_classrooms.classroom_id WHERE lesson_classrooms.lesson_id = lessons.id AND classroom_students.student_id = ?))"
            lesson_params.append(student_id or -1)
        lesson_query += ' ORDER BY sort_order ASC, id ASC'
        c.execute(lesson_query, lesson_params)
        lessons_rows = c.fetchall()

        for l_row in lessons_rows:
            lesson = {
                "id": l_row["id"],
                "badge": l_row["badge"],
                "title_ar": l_row["title_ar"],
                "title_en": l_row["title_en"],
                "subtitle": l_row["subtitle"],
                "reinforcement_type": l_row["reinforcement_type"] or "slides",
                "content_status": l_row["content_status"] or "published",
                "classroom_ids": [],
                "slides": [],
                "reinforcement_slides": [],
                "exercises": [],
                "reinforcement_exercises": [],
                "exam_questions": []
            }

            c.execute('SELECT classroom_id FROM lesson_classrooms WHERE lesson_id = ?', (l_row['id'],))
            lesson['classroom_ids'] = [row['classroom_id'] for row in c.fetchall()]

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


def current_student_id():
    student_id = session.get('student_id')
    try:
        return int(student_id) if student_id else None
    except (TypeError, ValueError):
        return None


def get_student_summary(student_id):
    conn = get_db_connection()
    c = conn.cursor()

    c.execute("SELECT COUNT(*) FROM lessons WHERE content_status = 'published'")
    total_lessons = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM student_progress WHERE student_id = ? AND status = 'completed'", (student_id,))
    completed_lessons = c.fetchone()[0]
    c.execute('SELECT COUNT(*) FROM student_attempts WHERE student_id = ?', (student_id,))
    attempts = c.fetchone()[0]
    c.execute('SELECT COUNT(*) FROM student_attempts WHERE student_id = ? AND is_correct = 1', (student_id,))
    correct_attempts = c.fetchone()[0]
    conn.close()

    return {
        'total_lessons': total_lessons,
        'completed_lessons': completed_lessons,
        'completion_percent': round((completed_lessons / total_lessons) * 100) if total_lessons else 0,
        'attempts': attempts,
        'accuracy_percent': round((correct_attempts / attempts) * 100) if attempts else 0,
    }


def get_student_classroom(student_id):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute('''
        SELECT classrooms.id, classrooms.name, classrooms.join_code
        FROM classrooms
        JOIN classroom_students ON classroom_students.classroom_id = classrooms.id
        WHERE classroom_students.student_id = ?
        ORDER BY classroom_students.joined_at DESC
        LIMIT 1
    ''', (student_id,))
    classroom = c.fetchone()
    conn.close()
    return dict(classroom) if classroom else None


def make_join_code(cursor):
    # Short enough to type on a phone, but checked for uniqueness before use.
    while True:
        code = secrets.token_hex(3).upper()
        cursor.execute('SELECT 1 FROM classrooms WHERE join_code = ?', (code,))
        if not cursor.fetchone():
            return code

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

        if hmac.compare_digest(username, ADMIN_USERNAME) and hmac.compare_digest(password, ADMIN_PASSWORD):
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
    return render_template('index.html', app_mode='admin', username=session.get('username', ADMIN_USERNAME))


@app.route('/learn')
def learn():
    return render_template('index.html', app_mode='student')


@app.route('/api/student/session', methods=['POST'])
def create_student_session():
    payload = request.get_json(silent=True) or {}
    display_name = re.sub(r'\s+', ' ', str(payload.get('display_name', '')).strip())
    class_code = re.sub(r'[^A-Za-z0-9]', '', str(payload.get('class_code', '')).upper())
    if not 2 <= len(display_name) <= 60:
        return jsonify({'success': False, 'message': 'اكتب اسماً بين حرفين و60 حرفاً.'}), 400

    conn = get_db_connection()
    c = conn.cursor()
    classroom = None
    if class_code:
        c.execute('SELECT id, name, join_code FROM classrooms WHERE join_code = ?', (class_code,))
        classroom = c.fetchone()
        if not classroom:
            conn.close()
            return jsonify({'success': False, 'message': 'رمز الصف غير صحيح. يمكنك البدء بدونه أو مراجعة المعلم.'}), 400

    c.execute('INSERT INTO students (display_name) VALUES (?)', (display_name,))
    student_id = c.lastrowid
    if classroom:
        c.execute('INSERT INTO classroom_students (classroom_id, student_id) VALUES (?, ?)', (classroom['id'], student_id))
    conn.commit()
    conn.close()

    session['student_id'] = student_id
    return jsonify({
        'success': True,
        'student': {'id': student_id, 'display_name': display_name, 'classroom': dict(classroom) if classroom else None},
        'summary': get_student_summary(student_id),
    })


@app.route('/api/student/profile', methods=['GET'])
def get_student_profile():
    student_id = current_student_id()
    if not student_id:
        return jsonify({'success': True, 'student': None, 'summary': None})

    conn = get_db_connection()
    c = conn.cursor()
    c.execute('SELECT id, display_name FROM students WHERE id = ?', (student_id,))
    student = c.fetchone()
    if not student:
        session.pop('student_id', None)
        conn.close()
        return jsonify({'success': True, 'student': None, 'summary': None})

    c.execute('UPDATE students SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?', (student_id,))
    conn.commit()
    conn.close()
    return jsonify({
        'success': True,
        'student': {'id': student['id'], 'display_name': student['display_name'], 'classroom': get_student_classroom(student_id)},
        'summary': get_student_summary(student_id),
    })


@app.route('/api/student/progress', methods=['POST'])
def save_student_progress():
    student_id = current_student_id()
    if not student_id:
        return jsonify({'success': False, 'message': 'ابدأ باسمك أولاً لحفظ تقدمك.'}), 401

    payload = request.get_json(silent=True) or {}
    lesson_id = payload.get('lesson_id')
    try:
        lesson_id = int(lesson_id)
        current_slide_index = max(0, int(payload.get('current_slide_index', 0)))
    except (TypeError, ValueError):
        return jsonify({'success': False, 'message': 'بيانات الدرس غير صالحة.'}), 400

    status = payload.get('status', 'in_progress')
    if status not in {'not_started', 'in_progress', 'completed'}:
        return jsonify({'success': False, 'message': 'حالة التقدم غير صالحة.'}), 400

    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT id FROM lessons WHERE id = ? AND content_status = 'published'", (lesson_id,))
    if not c.fetchone():
        conn.close()
        return jsonify({'success': False, 'message': 'الدرس غير موجود.'}), 404

    c.execute('''
        INSERT INTO student_progress (student_id, lesson_id, status, current_slide_index, completed_at)
        VALUES (?, ?, ?, ?, CASE WHEN ? = 'completed' THEN CURRENT_TIMESTAMP ELSE NULL END)
        ON CONFLICT(student_id, lesson_id) DO UPDATE SET
            status = CASE
                WHEN student_progress.status = 'completed' THEN 'completed'
                ELSE excluded.status
            END,
            current_slide_index = MAX(student_progress.current_slide_index, excluded.current_slide_index),
            updated_at = CURRENT_TIMESTAMP,
            completed_at = CASE
                WHEN student_progress.status = 'completed' OR excluded.status = 'completed' THEN COALESCE(student_progress.completed_at, CURRENT_TIMESTAMP)
                ELSE NULL
            END
    ''', (student_id, lesson_id, status, current_slide_index, status))
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'summary': get_student_summary(student_id)})


@app.route('/api/student/attempts', methods=['POST'])
def save_student_attempt():
    student_id = current_student_id()
    if not student_id:
        return jsonify({'success': False, 'message': 'ابدأ باسمك أولاً لحفظ نتيجتك.'}), 401

    payload = request.get_json(silent=True) or {}
    try:
        lesson_id = int(payload.get('lesson_id'))
        exercise_id = int(payload.get('exercise_id'))
        selected_index = int(payload.get('selected_index'))
    except (TypeError, ValueError):
        return jsonify({'success': False, 'message': 'بيانات الإجابة غير صالحة.'}), 400

    conn = get_db_connection()
    c = conn.cursor()
    c.execute('''
        SELECT exercises.correct_index
        FROM exercises JOIN lessons ON lessons.id = exercises.lesson_id
        WHERE exercises.id = ? AND exercises.lesson_id = ? AND lessons.content_status = 'published'
    ''', (exercise_id, lesson_id))
    exercise = c.fetchone()
    if not exercise:
        conn.close()
        return jsonify({'success': False, 'message': 'السؤال غير موجود.'}), 404

    is_correct = int(selected_index == exercise['correct_index'])
    c.execute('''
        INSERT INTO student_attempts (student_id, lesson_id, exercise_id, selected_index, is_correct)
        VALUES (?, ?, ?, ?, ?)
    ''', (student_id, lesson_id, exercise_id, selected_index, is_correct))
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'is_correct': bool(is_correct), 'summary': get_student_summary(student_id)})


@app.route('/api/admin/dashboard', methods=['GET'])
@login_required
def get_admin_dashboard():
    conn = get_db_connection()
    c = conn.cursor()
    c.execute('SELECT COUNT(*) FROM units')
    units = c.fetchone()[0]
    c.execute('SELECT COUNT(*) FROM lessons')
    lessons = c.fetchone()[0]
    c.execute('SELECT COUNT(*) FROM exercises')
    exercises = c.fetchone()[0]
    c.execute('SELECT COUNT(*) FROM slides')
    slides = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM lessons WHERE content_status = 'draft'")
    draft_lessons = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM student_progress WHERE status = 'completed'")
    completed_lessons = c.fetchone()[0]
    conn.close()
    return jsonify({
        'success': True,
        'stats': {
            'units': units,
            'lessons': lessons,
            'exercises': exercises,
            'slides': slides,
            'draft_lessons': draft_lessons,
            'completed_lessons': completed_lessons,
        },
    })


@app.route('/api/admin/classes', methods=['GET', 'POST'])
@login_required
def admin_classes():
    conn = get_db_connection()
    c = conn.cursor()

    if request.method == 'POST':
        payload = request.get_json(silent=True) or {}
        name = re.sub(r'\s+', ' ', str(payload.get('name', '')).strip())
        if not 2 <= len(name) <= 80:
            conn.close()
            return jsonify({'success': False, 'message': 'اكتب اسم الصف بين حرفين و80 حرفاً.'}), 400
        code = make_join_code(c)
        c.execute('INSERT INTO classrooms (name, join_code) VALUES (?, ?)', (name, code))
        classroom_id = c.lastrowid
        conn.commit()
        c.execute('SELECT id, name, join_code, created_at FROM classrooms WHERE id = ?', (classroom_id,))
        classroom = dict(c.fetchone())
        conn.close()
        return jsonify({'success': True, 'classroom': classroom}), 201

    c.execute('''
        SELECT classrooms.id, classrooms.name, classrooms.join_code, classrooms.created_at,
               (SELECT COUNT(*) FROM classroom_students WHERE classroom_id = classrooms.id) AS student_count,
               (SELECT COUNT(*) FROM student_attempts JOIN classroom_students ON classroom_students.student_id = student_attempts.student_id
                    WHERE classroom_students.classroom_id = classrooms.id) AS attempts,
               COALESCE((SELECT ROUND(100.0 * SUM(student_attempts.is_correct) / NULLIF(COUNT(*), 0))
                    FROM student_attempts JOIN classroom_students ON classroom_students.student_id = student_attempts.student_id
                    WHERE classroom_students.classroom_id = classrooms.id), 0) AS accuracy_percent,
               (SELECT COUNT(*) FROM student_progress JOIN classroom_students ON classroom_students.student_id = student_progress.student_id
                    WHERE classroom_students.classroom_id = classrooms.id AND student_progress.status = 'completed') AS completed_lessons
        FROM classrooms
        ORDER BY classrooms.created_at DESC, classrooms.id DESC
    ''')
    classrooms = [dict(row) for row in c.fetchall()]
    conn.close()
    return jsonify({'success': True, 'classrooms': classrooms})


@app.route('/api/admin/classes/<int:classroom_id>', methods=['DELETE'])
@login_required
def delete_admin_class(classroom_id):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute('SELECT id, name FROM classrooms WHERE id = ?', (classroom_id,))
    classroom = c.fetchone()
    if not classroom:
        conn.close()
        return jsonify({'success': False, 'message': 'الصف غير موجود أو تم حذفه.'}), 404

    # Keep learner profiles and learning evidence; only remove their membership in this class.
    c.execute('DELETE FROM classroom_students WHERE classroom_id = ?', (classroom_id,))
    c.execute('DELETE FROM classrooms WHERE id = ?', (classroom_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'message': f"تم حذف صف {classroom['name']}."})


@app.route('/api/admin/analytics', methods=['GET'])
@login_required
def admin_analytics():
    conn = get_db_connection()
    c = conn.cursor()
    c.execute('SELECT COUNT(*) FROM students')
    students = c.fetchone()[0]
    c.execute('SELECT COUNT(*) FROM student_attempts')
    attempts = c.fetchone()[0]
    c.execute('SELECT COUNT(*) FROM student_attempts WHERE is_correct = 1')
    correct_attempts = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM student_progress WHERE status = 'completed'")
    completed = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM lessons WHERE content_status = 'published'")
    published_lessons = c.fetchone()[0]
    c.execute('''
        SELECT exercises.id, exercises.question_en, exercises.sentence_ar,
               COUNT(student_attempts.id) AS attempts,
               COALESCE(ROUND(100.0 * SUM(CASE WHEN student_attempts.is_correct = 1 THEN 1 ELSE 0 END) /
                    NULLIF(COUNT(student_attempts.id), 0)), 0) AS accuracy_percent
        FROM exercises
        LEFT JOIN student_attempts ON student_attempts.exercise_id = exercises.id
        GROUP BY exercises.id
        HAVING COUNT(student_attempts.id) > 0
        ORDER BY accuracy_percent ASC, attempts DESC
        LIMIT 5
    ''')
    weakest_questions = [dict(row) for row in c.fetchall()]
    conn.close()
    return jsonify({'success': True, 'overview': {
        'students': students,
        'attempts': attempts,
        'accuracy_percent': round((correct_attempts / attempts) * 100) if attempts else 0,
        'completed_lessons': completed,
        'published_lessons': published_lessons,
    }, 'weakest_questions': weakest_questions})

@app.route('/api/upload_image', methods=['POST'])
@login_required
def upload_image():
    if 'image_file' not in request.files:
        return jsonify({"success": False, "message": "لم يتم اختيار أي ملف"}), 400
    
    file = request.files['image_file']
    if file.filename == '':
        return jsonify({"success": False, "message": "اسم الملف فارغ"}), 400
    
    ext = os.path.splitext(file.filename)[1].lower()
    allowed_extensions = {'.jpg', '.jpeg', '.png', '.gif', '.webp'}
    allowed_mimetypes = {'image/jpeg', 'image/png', 'image/gif', 'image/webp'}
    if ext not in allowed_extensions or file.mimetype not in allowed_mimetypes:
        return jsonify({"success": False, "message": "يُسمح برفع صور JPG أو PNG أو GIF أو WebP فقط."}), 400
    
    filename = f"img_{int(time.time() * 1000)}{ext}"
    filepath = os.path.join(UPLOAD_FOLDER, filename)
    file.save(filepath)
    
    image_url = f"/static/uploads/{filename}"
    return jsonify({"success": True, "image_url": image_url})

@app.route('/api/curriculum', methods=['GET'])
def get_curriculum():
    is_teacher = bool(session.get('logged_in'))
    data = get_curriculum_data_from_db(include_drafts=is_teacher, student_id=None if is_teacher else current_student_id())
    return jsonify({"success": True, "curriculum": data})

@app.route('/api/slides', methods=['GET'])
def get_slides():
    is_teacher = bool(session.get('logged_in'))
    data = get_curriculum_data_from_db(include_drafts=is_teacher, student_id=None if is_teacher else current_student_id())
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
    is_reinf = 1 if payload.get("is_reinforcement") else 0

    conn = get_db_connection()
    c = conn.cursor()

    c.execute('SELECT MAX(sort_order) FROM slides WHERE lesson_id = ? AND is_reinforcement = ?', (lesson_id, is_reinf))
    max_row = c.fetchone()
    max_order = max_row[0] if (max_row and max_row[0] is not None) else -1
    next_sort_order = max_order + 1

    c.execute('''
        INSERT INTO slides (lesson_id, template_type, welcome_badge, title_ar, title_en, description_ar, description_en,
        rule_title, rule_desc, example_en, example_ar, image, teacher_notes, scene_badge, question_ar, hint_note, wrong_note,
        options_json, correct_index, result_title, reveal_badge, reveal_explanation, reveal_note, blocks_order_json, linked_exercise_id, is_reinforcement, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        is_reinf,
        next_sort_order
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
    for f in ["title_ar", "title_en", "badge", "subtitle", "reinforcement_type", "content_status"]:
        if f in payload:
            if f == 'content_status' and payload[f] not in {'draft', 'published'}:
                conn.close()
                return jsonify({'success': False, 'message': 'حالة المحتوى غير صالحة.'}), 400
            fields.append(f"{f} = ?")
            params.append(payload[f])

    if fields:
        params.append(lesson_id)
        c.execute(f"UPDATE lessons SET {', '.join(fields)} WHERE id = ?", params)
        conn.commit()

    if 'classroom_ids' in payload:
        try:
            classroom_ids = sorted({int(classroom_id) for classroom_id in payload['classroom_ids']})
        except (TypeError, ValueError):
            conn.close()
            return jsonify({'success': False, 'message': 'اختيار الصفوف غير صالح.'}), 400
        if classroom_ids:
            placeholders = ','.join('?' for _ in classroom_ids)
            c.execute(f'SELECT COUNT(*) FROM classrooms WHERE id IN ({placeholders})', classroom_ids)
            if c.fetchone()[0] != len(classroom_ids):
                conn.close()
                return jsonify({'success': False, 'message': 'يوجد صف غير صالح ضمن الاختيار.'}), 400
        c.execute('DELETE FROM lesson_classrooms WHERE lesson_id = ?', (lesson_id,))
        c.executemany('INSERT INTO lesson_classrooms (lesson_id, classroom_id) VALUES (?, ?)', [(lesson_id, classroom_id) for classroom_id in classroom_ids])
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
    subtitle = payload.get('subtitle', '3 شرائح شرح + تمرين تفاعلي')
    template_type = payload.get('template_type', 'two_stage')

    conn = get_db_connection()
    c = conn.cursor()

    c.execute('SELECT MAX(id) FROM lessons')
    max_id = c.fetchone()[0] or 100
    new_lesson_id = max_id + 1

    c.execute('''
        INSERT INTO lessons (id, unit_id, badge, title_ar, title_en, subtitle, reinforcement_type, content_status)
        VALUES (?, ?, ?, ?, ?, ?, 'slides', 'draft')
    ''', (new_lesson_id, unit_id, f"الدرس {new_lesson_id - 100}", f"الدرس: {title_ar}", f"Lesson – {title_en}", subtitle))

    # Add default slide
    c.execute('''
        INSERT INTO slides (lesson_id, template_type, welcome_badge, title_ar, title_en, description_ar, image, blocks_order_json)
        VALUES (?, ?, 'اكتشف القاعدة بنفسك', ?, ?, 'شريحة شرح تفاعلية جديدة.', '/static/images/kids_football.jpg', '["two_stage_block"]')
    ''', (new_lesson_id, template_type, title_ar, title_en))

    # Add default exercise
    c.execute('''
        INSERT INTO exercises (lesson_id, instruction_badge, sentence_ar, question_en, options_json, correct_index, image)
        VALUES (?, 'اختبر معلوماتك', 'اختر الإجابة المناسبة.', 'She _____ to school.', '["goes", "go", "going"]', 0, '/static/images/girl_school.jpg')
    ''', (new_lesson_id,))

    conn.commit()
    conn.close()

    return jsonify({"success": True, "new_lesson_id": new_lesson_id, "curriculum": get_curriculum_data_from_db()})


@app.route('/api/lessons/<int:lesson_id>/duplicate', methods=['POST'])
@login_required
def duplicate_lesson(lesson_id):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute('SELECT * FROM lessons WHERE id = ?', (lesson_id,))
    source = c.fetchone()
    if not source:
        conn.close()
        return jsonify({'success': False, 'message': 'الدرس غير موجود.'}), 404

    c.execute('SELECT MAX(id) FROM lessons')
    new_lesson_id = (c.fetchone()[0] or 100) + 1
    c.execute('SELECT COALESCE(MAX(sort_order), -1) + 1 FROM lessons WHERE unit_id = ?', (source['unit_id'],))
    next_sort_order = c.fetchone()[0]
    c.execute('''
        INSERT INTO lessons (id, unit_id, badge, title_ar, title_en, subtitle, reinforcement_type, content_status, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?)
    ''', (new_lesson_id, source['unit_id'], source['badge'], f"نسخة من: {source['title_ar']}", source['title_en'], source['subtitle'], source['reinforcement_type'], next_sort_order))

    c.execute('SELECT * FROM slides WHERE lesson_id = ? ORDER BY id', (lesson_id,))
    for slide in c.fetchall():
        c.execute('''
            INSERT INTO slides (lesson_id, template_type, welcome_badge, title_ar, title_en, description_ar, description_en, rule_title, rule_desc, example_en, example_ar, image, teacher_notes, scene_badge, question_ar, hint_note, wrong_note, options_json, correct_index, result_title, reveal_badge, reveal_explanation, reveal_note, blocks_order_json, linked_exercise_id, is_reinforcement, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (new_lesson_id, slide['template_type'], slide['welcome_badge'], slide['title_ar'], slide['title_en'], slide['description_ar'], slide['description_en'], slide['rule_title'], slide['rule_desc'], slide['example_en'], slide['example_ar'], slide['image'], slide['teacher_notes'], slide['scene_badge'], slide['question_ar'], slide['hint_note'], slide['wrong_note'], slide['options_json'], slide['correct_index'], slide['result_title'], slide['reveal_badge'], slide['reveal_explanation'], slide['reveal_note'], slide['blocks_order_json'], slide['linked_exercise_id'], slide['is_reinforcement'], slide['sort_order']))

    c.execute('SELECT * FROM exercises WHERE lesson_id = ? ORDER BY id', (lesson_id,))
    for exercise in c.fetchall():
        c.execute('''
            INSERT INTO exercises (lesson_id, question_type, instruction_badge, sentence_ar, question_en, options_json, correct_index, explanation, wrong_note, result_title, reveal_badge, reveal_explanation, image, linked_exercise_id, is_reinforcement, is_exam, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (new_lesson_id, exercise['question_type'], exercise['instruction_badge'], exercise['sentence_ar'], exercise['question_en'], exercise['options_json'], exercise['correct_index'], exercise['explanation'], exercise['wrong_note'], exercise['result_title'], exercise['reveal_badge'], exercise['reveal_explanation'], exercise['image'], exercise['linked_exercise_id'], exercise['is_reinforcement'], exercise['is_exam'], exercise['sort_order']))

    conn.commit()
    conn.close()
    return jsonify({'success': True, 'new_lesson_id': new_lesson_id, 'curriculum': get_curriculum_data_from_db()})

@app.route('/api/exercises', methods=['POST'])
@login_required
def add_exercise():
    payload = request.get_json() or {}
    lesson_id = payload.get('lesson_id', 101)

    question_type = payload.get('question_type', payload.get('template_type', 'multiple_choice'))
    defaults = {
        'multiple_choice': {
            'instruction_badge': 'اختر الإجابة الصحيحة',
            'sentence_ar': 'اختر الفعل المناسب للجملة.',
            'question_en': 'He _____ to the park every weekend.',
            'options': ['goes', 'go', 'going'],
            'explanation': 'نستخدم goes مع الضمير المفرد He.',
        },
        'fill_in_blank': {
            'instruction_badge': 'أكمل الفراغ',
            'sentence_ar': 'اختر الكلمة التي تكمل الجملة.',
            'question_en': 'She _____ English every day.',
            'options': ['studies', 'study', 'studying'],
            'explanation': 'مع She نضيف s أو es للفعل في المضارع البسيط.',
        },
        'image_choice': {
            'instruction_badge': 'انظر إلى الصورة واختر الوصف',
            'sentence_ar': 'ما الجملة التي تصف الصورة؟',
            'question_en': 'He _____ football after school.',
            'options': ['plays', 'reads', 'sleeps'],
            'explanation': 'الصورة تُظهر الولد وهو يلعب كرة القدم.',
        },
        'listening': {
            'instruction_badge': 'استمع ثم اختر الإجابة',
            'sentence_ar': 'اضغط على زر الاستماع ثم اختر الكلمة التي سمعتها.',
            'question_en': 'She reads a story every evening.',
            'options': ['reads', 'plays', 'writes'],
            'explanation': 'الجملة تتحدث عن القراءة في المساء.',
        },
        'ordering': {
            'instruction_badge': 'رتّب الكلمات لتكوين جملة',
            'sentence_ar': 'اضغط الكلمات بالترتيب الصحيح.',
            'question_en': 'They play football after school.',
            'options': ['They', 'play', 'football', 'after', 'school.'],
            'explanation': 'نبدأ بالفاعل ثم الفعل ثم بقية الجملة.',
        },
        'matching': {
            'instruction_badge': 'طابق كل كلمة مع معناها',
            'sentence_ar': 'اختر زوجاً من الجهة اليمنى والجهة اليسرى.',
            'question_en': 'Match the pronouns with their meanings.',
            'options': [
                {'left': 'He', 'right': 'ولد واحد'},
                {'left': 'She', 'right': 'بنت واحدة'},
                {'left': 'They', 'right': 'أكثر من شخص'},
            ],
            'explanation': 'راجع معنى كل ضمير قبل المطابقة.',
        },
        'pronunciation': {
            'instruction_badge': 'قل الجملة بصوتك',
            'sentence_ar': 'اضغط على الميكروفون وانطق الجملة، أو اكتبها إذا لم يتوفر الميكروفون.',
            'question_en': 'I read every day.',
            'options': [],
            'explanation': 'ركّز على نطق كلمات الجملة بوضوح.',
        },
    }
    default = defaults.get(question_type, defaults['multiple_choice'])

    conn = get_db_connection()
    c = conn.cursor()

    c.execute('''
        INSERT INTO exercises (lesson_id, question_type, instruction_badge, sentence_ar, question_en, options_json, correct_index, explanation, image, linked_exercise_id, is_reinforcement, is_exam)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
    ''', (
        lesson_id,
        question_type,
        payload.get("instruction_badge", default['instruction_badge']),
        payload.get("sentence_ar", default['sentence_ar']),
        payload.get("question_en", default['question_en']),
        json.dumps(payload.get("options", default['options']), ensure_ascii=False),
        payload.get("correct_index", 0),
        payload.get("explanation", default['explanation']),
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
@login_required
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
