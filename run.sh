#!/bin/bash

echo "🚀 جاري تشغيل مشروع بايثون ويب..."

# Check virtual environment
if [ -d "venv" ]; then
    source venv/bin/activate
else
    echo "📦 إنشاء بيئة افتراضية جديد..."
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
fi

python3 app.py
