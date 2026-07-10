from app.services.ingest import chunk_text


def test_empty_text_gives_no_chunks() -> None:
    assert chunk_text("") == []
    assert chunk_text("   \n\n  ") == []


def test_short_text_is_one_chunk() -> None:
    assert chunk_text("hello world", size=100, overlap=10) == ["hello world"]


def test_long_text_chunks_overlap() -> None:
    text = "abcdefghij" * 50  # 500 chars
    chunks = chunk_text(text, size=200, overlap=50)
    assert all(len(c) <= 200 for c in chunks)
    # consecutive chunks share the overlap region
    assert chunks[0][-50:] == chunks[1][:50]
    # nothing is lost: stitched-together chunks reproduce the source
    stitched = chunks[0] + "".join(c[50:] for c in chunks[1:])
    assert stitched == text
