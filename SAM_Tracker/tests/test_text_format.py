from app.text_format import clean, format_description, plain, split_paragraphs


def paragraphs(text):
    return [plain(p) for p in split_paragraphs(text)]


def test_long_block_is_split_every_three_sentences():
    text = "One here. Two here. Three here. Four here. Five here."
    assert paragraphs(text) == ["One here. Two here. Three here.", "Four here. Five here."]


def test_abbreviations_do_not_end_a_sentence():
    text = "The U.S. Army needs help, e.g. Branding for No. 5 building. Next."
    assert paragraphs(text) == [text]


def test_section_titles_start_a_paragraph():
    text = "Intro text. Contract Type NHTSA intends to award. Period of Performance: one year."
    assert paragraphs(text) == [
        "Intro text.", "Contract Type: NHTSA intends to award.", "Period of Performance: one year.",
    ]


def test_title_words_inside_a_sentence_are_not_titles():
    text = "The NAICS Code assigned is 811210. Next."
    assert paragraphs(text) == [text]


def test_capital_labels_each_start_a_paragraph():
    text = ("PRESOLICITATION NOTICE Solicitation Number: FA2550 NAICS CODE: 541511 "
            "SIZE STANDARD: $34M PRODUCT SERVICE CODE (PSC): DJ10 Contract to Argonne: services.")
    assert paragraphs(text) == [
        "PRESOLICITATION NOTICE", "Solicitation Number: FA2550", "NAICS CODE: 541511",
        "SIZE STANDARD: $34M", "PRODUCT SERVICE CODE (PSC): DJ10 Contract to Argonne: services.",
    ]


def test_numbered_list_items_get_one_line_each():
    text = "Responses should include the following: 1. Company name. 2. Point of contact. 3. Size."
    assert paragraphs(text) == [
        "Responses should include the following:", "1. Company name.", "2. Point of contact.", "3. Size.",
    ]


def test_author_line_breaks_are_kept():
    assert paragraphs("First part\n\nSecond part") == ["First part", "Second part"]


def test_html_entities_and_broken_quotes_are_cleaned():
    assert clean("<p>Hello&nbsp;<b>world</b></p><p>Bye &amp; thanks</p>") == "Hello world\nBye & thanks"
    assert clean("Woodyâ€? Williams") == "Woody' Williams"


def test_output_is_escaped_labels_bold_and_keywords_highlighted():
    html = str(format_description(
        "Web design <script>x</script> work. Period of Performance: 1 year. POINT OF CONTACT: Jane", "web design"
    ))
    assert "<script>" not in html
    assert "<mark>Web design</mark>" in html
    assert "<strong>Period of Performance:</strong>" in html
    assert "<strong>POINT OF CONTACT:</strong> Jane" in html


def test_empty_description():
    assert "No description available" in str(format_description("", None))
